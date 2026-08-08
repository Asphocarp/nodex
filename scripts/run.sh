#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

use_codex_home="true"
use_nodex_home="true"
copy_codex_auth="false"
requested_auth_json=""
copy_codex_config="false"
keep_run_root="false"
requested_run_root=""
run_script="build:run"
reuse_build="false"

run_root=""
isolated_codex_home=""
isolated_nodex_home=""
isolated_initial_projects_directory=""

usage() {
  cat <<'EOF'
Usage:
  scripts/run.sh [options]
  pnpm run build:run:isolated -- [options]

Run Nodex with isolated temporary state. By default, both CODEX_HOME and
NODEX_HOME point into a new temporary directory that is deleted on exit.

Options:
  -a, --auth        Copy auth.json from the current Codex home.
      --auth-json FILE
                    Copy FILE as auth.json instead of using the current Codex
                    home. Cannot be combined with --auth or --global-codex.
  -c, --config      Copy portable config.toml settings from the current Codex
                    home. Nodex-owned Browser runtime settings are omitted.
      --global-codex
                    Use the inherited or default global CODEX_HOME.
      --global-nodex
                    Use the inherited or default global NODEX_HOME.
  -d, --dev         Run the development server instead of the built app.
      --reuse-build Require a content-verified production build and fail if it
                    is stale. Normal production runs reuse it automatically
                    when verification succeeds, otherwise they rebuild.
  -k, --keep        Preserve the run root after Nodex exits.
  -r, --root DIR    Use DIR as the run root. DIR may already exist with --keep.
  -h, --help        Show this help message.

Environment:
  NODEX_REMOTE_DEBUGGING_PORT
                    Electron CDP port (default: 0, letting the OS select an
                    available port for this run).
  NODEX_SHOW_MACOS_INPUT_SOURCE_LOGS
                    Set to 1 to show macOS input-source cache diagnostics that
                    are hidden by default.
  NODEX_INITIAL_PROJECTS_DIR
                    Initial Project parent. Isolated runs set this to the run
                    root's workspace directory.

Short options without values may be combined, for example: -ac or -dak.

Examples:
  pnpm run build:run:isolated
  pnpm run build:run:isolated -- -ac
  pnpm run build:run:isolated -- -dak
  scripts/run.sh --auth-json /path/to/auth.json
  scripts/run.sh --root /tmp/nodex-manual-run --keep
  scripts/run.sh --root /tmp/nodex-manual-run --keep --reuse-build
  scripts/run.sh --global-codex --global-nodex --dev
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

is_known_macos_input_source_noise() {
  local line="$1"
  local layout_id

  case "${line}" in
  *"TISFileInterrogator updateSystemInputSources false but old data invalid:"*)
    return 0
    ;;
  esac

  for layout_id in -17410 -30769 -14934; do
    if [[ "${line}" == "Keyboard Layouts: duplicate keyboard layout identifier ${layout_id}." ]]; then
      return 0
    fi
    if [[ "${line}" == "Keyboard Layouts: keyboard layout identifier ${layout_id} has been replaced with -"* ]]; then
      return 0
    fi
  done

  return 1
}

filter_macos_input_source_noise() {
  local line

  while IFS= read -r line || [[ -n "${line}" ]]; do
    if is_known_macos_input_source_noise "${line}"; then
      continue
    fi
    printf '%s\n' "${line}" >&2
  done
}

while (($# > 0)); do
  case "$1" in
  -a | --auth)
    copy_codex_auth="true"
    shift
    ;;
  --auth-json)
    shift
    (($# > 0)) || fail "Expected a file after --auth-json."
    [[ -n "$1" ]] || fail "The --auth-json file cannot be empty."
    [[ -z "${requested_auth_json}" ]] || fail "--auth-json may be specified only once."
    requested_auth_json="$1"
    shift
    ;;
  --auth-json=*)
    [[ -z "${requested_auth_json}" ]] || fail "--auth-json may be specified only once."
    requested_auth_json="${1#*=}"
    [[ -n "${requested_auth_json}" ]] || fail "The --auth-json file cannot be empty."
    shift
    ;;
  -c | --config)
    copy_codex_config="true"
    shift
    ;;
  --global-codex)
    use_codex_home="false"
    shift
    ;;
  --global-nodex)
    use_nodex_home="false"
    shift
    ;;
  -d | --dev)
    run_script="dev"
    shift
    ;;
  --reuse-build)
    reuse_build="true"
    shift
    ;;
  -k | --keep)
    keep_run_root="true"
    shift
    ;;
  -[acdk]*)
    short_options="${1#-}"
    while [[ -n "${short_options}" ]]; do
      case "${short_options:0:1}" in
      a) copy_codex_auth="true" ;;
      c) copy_codex_config="true" ;;
      d) run_script="dev" ;;
      k) keep_run_root="true" ;;
      *) fail "Unknown short option in $1: -${short_options:0:1}" ;;
      esac
      short_options="${short_options:1}"
    done
    shift
    ;;
  -r | --root)
    shift
    (($# > 0)) || fail "Expected a directory after --root."
    [[ -n "$1" ]] || fail "The --root directory cannot be empty."
    requested_run_root="$1"
    shift
    ;;
  --root=*)
    requested_run_root="${1#*=}"
    [[ -n "${requested_run_root}" ]] || fail "The --root directory cannot be empty."
    shift
    ;;
  --help | -h)
    usage
    exit 0
    ;;
  --)
    shift
    ;;
  *)
    fail "Unknown argument: $1"
    ;;
  esac
done

if [[ "${reuse_build}" == "true" ]]; then
  [[ "${run_script}" != "dev" ]] || fail "--reuse-build cannot be combined with --dev."
  run_script="build:run:prepared"
fi

if [[ "${copy_codex_auth}" == "true" && -n "${requested_auth_json}" ]]; then
  fail "--auth cannot be combined with --auth-json."
fi

if [[ "${use_codex_home}" != "true" && ("${copy_codex_auth}" == "true" || -n "${requested_auth_json}" || "${copy_codex_config}" == "true") ]]; then
  fail "--global-codex cannot be combined with --auth, --auth-json, or --config."
fi

if [[ "${use_codex_home}" != "true" && "${use_nodex_home}" != "true" ]]; then
  [[ -z "${requested_run_root}" ]] || fail "--root requires an isolated Codex home or Nodex home."
  [[ "${keep_run_root}" != "true" ]] || fail "--keep requires an isolated Codex home or Nodex home."
fi

resolve_source_codex_home() {
  if [[ -n "${CODEX_HOME:-}" ]]; then
    printf '%s\n' "${CODEX_HOME}"
    return
  fi

  [[ -n "${HOME:-}" ]] || fail "HOME and CODEX_HOME are both unset; the Codex home cannot be resolved."
  printf '%s/.codex\n' "${HOME}"
}

cleanup() {
  local exit_code="$1"
  trap - EXIT

  if [[ -z "${run_root}" ]]; then
    exit "${exit_code}"
  fi

  if [[ "${keep_run_root}" == "true" ]]; then
    printf 'Preserved isolated run directory: %s\n' "${run_root}"
  elif [[ "${use_nodex_home}" == "true" &&
    -n "${isolated_nodex_home}" ]] &&
    isolated_nodex_runtime_evidence_exists "${isolated_nodex_home}"; then
    printf 'Warning: isolated Core shutdown could not be confirmed.\n' >&2
    printf 'Preserved isolated run directory for safety: %s\n' "${run_root}" >&2
  else
    rm -rf -- "${run_root}"
  fi

  exit "${exit_code}"
}

isolated_nodex_runtime_evidence_exists() {
  local nodex_home="$1"
  local run_directory="${nodex_home}/run"
  local core_directory="${run_directory}/core"
  local entry

  if [[ -L "${run_directory}" || -L "${core_directory}" ]]; then
    return 0
  fi

  for entry in \
    "${run_directory}/isolated-supervisor.lock" \
    "${core_directory}/core.json" \
    "${core_directory}/core.auth" \
    "${core_directory}/core.sock"; do
    if [[ -e "${entry}" || -L "${entry}" ]]; then
      return 0
    fi
  done

  return 1
}

if [[ "${use_codex_home}" == "true" || "${use_nodex_home}" == "true" ]]; then
  umask 077

  if [[ -n "${requested_run_root}" ]]; then
    requested_parent="$(dirname -- "${requested_run_root}")"
    requested_name="$(basename -- "${requested_run_root}")"
    [[ -d "${requested_parent}" ]] || fail "Run root parent directory not found: ${requested_parent}"
    requested_parent="$(cd -- "${requested_parent}" && pwd -P)"
    run_root="${requested_parent}/${requested_name}"

    if [[ -e "${run_root}" || -L "${run_root}" ]]; then
      [[ "${keep_run_root}" == "true" ]] || fail "Run root already exists; add --keep to reuse it: ${run_root}"
      [[ -d "${run_root}" ]] || fail "Run root is not a directory: ${run_root}"
    else
      mkdir "${run_root}"
    fi
  else
    temp_root="${TMPDIR:-/tmp}"
    run_root="$(mktemp -d "${temp_root%/}/nodex-run.XXXXXX")"
  fi

  trap 'exit 130' INT
  trap 'exit 143' TERM
  trap 'cleanup "$?"' EXIT
fi

if [[ "${use_codex_home}" == "true" ]]; then
  isolated_codex_home="${run_root}/.nodex/agent"
  mkdir -p "${isolated_codex_home}"

  if [[ "${copy_codex_auth}" == "true" || -n "${requested_auth_json}" || "${copy_codex_config}" == "true" ]]; then
    source_codex_home=""
    auth_source="${requested_auth_json}"

    if [[ "${copy_codex_auth}" == "true" || "${copy_codex_config}" == "true" ]]; then
      source_codex_home="$(resolve_source_codex_home)"
    fi

    if [[ "${copy_codex_auth}" == "true" ]]; then
      auth_source="${source_codex_home}/auth.json"
    fi

    if [[ -n "${auth_source}" ]]; then
      [[ -f "${auth_source}" ]] || fail "Codex auth file not found: ${auth_source}"
      cp -p "${auth_source}" "${isolated_codex_home}/auth.json"
      chmod 600 "${isolated_codex_home}/auth.json"
    fi

    if [[ "${copy_codex_config}" == "true" ]]; then
      config_source="${source_codex_home}/config.toml"
      [[ -f "${config_source}" ]] || fail "Codex config file not found: ${config_source}"
      node --import tsx \
        "${SCRIPT_DIR}/copy-isolated-codex-config.ts" \
        "${config_source}" \
        "${isolated_codex_home}/config.toml"
      chmod 600 "${isolated_codex_home}/config.toml"
    fi
  fi
fi

if [[ "${use_nodex_home}" == "true" ]]; then
  isolated_nodex_home="${run_root}/.nodex"
  isolated_initial_projects_directory="${run_root}/workspace"
  mkdir -p "${isolated_nodex_home}"
  mkdir -p "${isolated_initial_projects_directory}"
fi

printf 'Nodex run mode: %s\n' "${run_script}"
if [[ -n "${run_root}" ]]; then
  printf 'RUN_ROOT=%s\n' "${run_root}"
fi
if [[ "${use_codex_home}" == "true" ]]; then
  printf 'CODEX_HOME=%s\n' "${isolated_codex_home}"
else
  printf 'CODEX_HOME=<inherited or default>\n'
fi
if [[ "${use_nodex_home}" == "true" ]]; then
  printf 'NODEX_HOME=%s\n' "${isolated_nodex_home}"
  printf 'NODEX_INITIAL_PROJECTS_DIR=%s\n' "${isolated_initial_projects_directory}"
else
  printf 'NODEX_HOME=<inherited or default>\n'
  printf 'NODEX_INITIAL_PROJECTS_DIR=<inherited or Documents/Nodex>\n'
fi
printf 'NODEX_REMOTE_DEBUGGING_PORT=%s\n' "${NODEX_REMOTE_DEBUGGING_PORT:-0}"

run_nodex() (
  export NODEX_REMOTE_DEBUGGING_PORT="${NODEX_REMOTE_DEBUGGING_PORT:-0}"
  if [[ "${use_codex_home}" == "true" ]]; then
    export CODEX_HOME="${isolated_codex_home}"
  fi
  if [[ "${use_nodex_home}" == "true" ]]; then
    export NODEX_HOME="${isolated_nodex_home}"
    export NODEX_INITIAL_PROJECTS_DIR="${isolated_initial_projects_directory}"
  fi

  cd "${REPO_ROOT}"
  if [[ "${use_nodex_home}" == "true" ]]; then
    node --import tsx scripts/isolated-run-supervisor.ts -- "${run_script}"
  else
    pnpm --silent run "${run_script}"
  fi
)

if [[ "${NODEX_SHOW_MACOS_INPUT_SOURCE_LOGS:-0}" == "1" ]]; then
  run_nodex
else
  run_nodex 2> >(filter_macos_input_source_noise)
fi
