#!/usr/bin/env bash
set -Eeuo pipefail

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd -- "${SCRIPT_DIR}/.." && pwd)"

use_codex_home="true"
use_nodex_home="true"
copy_codex_auth="false"
copy_codex_config="false"
keep_run_root="false"
requested_run_root=""
run_script="build:run"
reuse_build="false"

run_root=""
isolated_codex_home=""
isolated_nodex_home=""

usage() {
  cat <<'EOF'
Usage:
  scripts/run.sh [options]
  pnpm run build:run:isolated -- [options]

Run Nodex with isolated temporary state. By default, both CODEX_HOME and
NODEX_HOME point into a new temporary directory that is deleted on exit.

Options:
  -a, --auth        Copy auth.json from the current Codex home.
  -c, --config      Copy config.toml from the current Codex home.
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

Short options without values may be combined, for example: -ac or -dak.

Examples:
  pnpm run build:run:isolated
  pnpm run build:run:isolated -- -ac
  pnpm run build:run:isolated -- -dak
  scripts/run.sh --root /tmp/nodex-manual-run --keep
  scripts/run.sh --root /tmp/nodex-manual-run --keep --reuse-build
  scripts/run.sh --global-codex --global-nodex --dev
EOF
}

fail() {
  printf 'Error: %s\n' "$1" >&2
  exit 1
}

while (($# > 0)); do
  case "$1" in
  -a | --auth)
    copy_codex_auth="true"
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

if [[ "${use_codex_home}" != "true" && ("${copy_codex_auth}" == "true" || "${copy_codex_config}" == "true") ]]; then
  fail "--global-codex cannot be combined with --auth or --config."
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
  else
    rm -rf -- "${run_root}"
  fi

  exit "${exit_code}"
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

  if [[ "${copy_codex_auth}" == "true" || "${copy_codex_config}" == "true" ]]; then
    source_codex_home="$(resolve_source_codex_home)"

    if [[ "${copy_codex_auth}" == "true" ]]; then
      auth_source="${source_codex_home}/auth.json"
      [[ -f "${auth_source}" ]] || fail "Codex auth file not found: ${auth_source}"
      cp -p "${auth_source}" "${isolated_codex_home}/auth.json"
      chmod 600 "${isolated_codex_home}/auth.json"
    fi

    if [[ "${copy_codex_config}" == "true" ]]; then
      config_source="${source_codex_home}/config.toml"
      [[ -f "${config_source}" ]] || fail "Codex config file not found: ${config_source}"
      cp -p "${config_source}" "${isolated_codex_home}/config.toml"
      chmod 600 "${isolated_codex_home}/config.toml"
    fi
  fi
fi

if [[ "${use_nodex_home}" == "true" ]]; then
  isolated_nodex_home="${run_root}/.nodex"
  mkdir -p "${isolated_nodex_home}"
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
else
  printf 'NODEX_HOME=<inherited or default>\n'
fi

(
  if [[ "${use_codex_home}" == "true" ]]; then
    export CODEX_HOME="${isolated_codex_home}"
  fi
  if [[ "${use_nodex_home}" == "true" ]]; then
    export NODEX_HOME="${isolated_nodex_home}"
  fi

  cd "${REPO_ROOT}"
  pnpm --silent run "${run_script}"
)
