import { act } from "react";
import { fireEvent, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { render } from "../../../test/dom";
import { ImageRemoveEditor } from "./image-remove-editor";

const IMAGE_SRC = "data:image/png;base64,AQID";
const MASK_SRC = "data:image/png;base64,bWFzaw==";

afterEach(() => vi.restoreAllMocks());

describe("ImageRemoveEditor", () => {
  test("captures a pointer stroke, supports undo/redo, and rasterizes the mask", async () => {
    const context = {
      arc: vi.fn(),
      beginPath: vi.fn(),
      fill: vi.fn(),
      fillRect: vi.fn(),
      fillStyle: "",
      lineCap: "butt",
      lineJoin: "miter",
      lineTo: vi.fn(),
      lineWidth: 1,
      moveTo: vi.fn(),
      stroke: vi.fn(),
      strokeStyle: "",
    } as unknown as CanvasRenderingContext2D;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => context);
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockReturnValue(MASK_SRC);
    const onSubmit = vi.fn();
    const view = render(
      <div className="h-[600px] w-[700px]">
        <ImageRemoveEditor
          alt="Uploaded image"
          src={IMAGE_SRC}
          onCancel={() => undefined}
          onSubmit={onSubmit}
        />
      </div>,
    );
    const image = view.getByRole("img", { name: "Uploaded image" });
    Object.defineProperties(image, {
      naturalHeight: { configurable: true, value: 500 },
      naturalWidth: { configurable: true, value: 1000 },
    });
    await act(async () => {
      fireEvent.load(image);
    });

    const canvas = view.getByLabelText("Mark areas to remove");
    vi.spyOn(canvas, "getBoundingClientRect").mockReturnValue({
      bottom: 200,
      height: 200,
      left: 0,
      right: 400,
      toJSON: () => ({}),
      top: 0,
      width: 400,
      x: 0,
      y: 0,
    });
    const setPointerCapture = vi.fn();
    const releasePointerCapture = vi.fn();
    Object.assign(canvas, {
      hasPointerCapture: () => true,
      releasePointerCapture,
      setPointerCapture,
    });

    await act(async () => {
      fireEvent.pointerDown(canvas, {
        button: 0,
        clientX: 100,
        clientY: 50,
        pointerId: 7,
      });
      fireEvent.pointerMove(canvas, {
        clientX: 200,
        clientY: 100,
        pointerId: 7,
      });
      fireEvent.pointerUp(canvas, {
        clientX: 200,
        clientY: 100,
        pointerId: 7,
      });
    });

    expect(setPointerCapture).toHaveBeenCalledWith(7);
    expect(releasePointerCapture).toHaveBeenCalledWith(7);
    const send = view.getByRole("button", { name: "Send" }) as HTMLButtonElement;
    await waitFor(() => expect(send.disabled).toBe(false));

    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Undo" }));
    });
    expect(send.disabled).toBe(true);
    await act(async () => {
      fireEvent.click(view.getByRole("button", { name: "Redo" }));
    });
    expect(send.disabled).toBe(false);

    await act(async () => {
      fireEvent.click(send);
    });
    expect(onSubmit).toHaveBeenCalledWith(MASK_SRC);
    expect(context.fillRect).toHaveBeenCalledWith(0, 0, 1000, 500);
    expect(context.moveTo).toHaveBeenCalled();
    expect(context.lineTo).toHaveBeenCalled();
  });
});
