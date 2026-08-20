export function AdvisoryList({ values }: { readonly values: readonly string[] }) {
  return (
    <ul>
      {values.map((value, index) => (
        <li key={index}>{value}</li>
      ))}
    </ul>
  );
}
