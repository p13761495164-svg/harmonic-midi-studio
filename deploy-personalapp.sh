#!/usr/bin/env bash

set -Eeuo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_CONTEXT="/Users/ben/Documents/Codex/2026-07-17/php-sqlite-app-vps-1-app/myApps.com_tFti3-reorganized/.deploy.env"
CONFIG_FILE="${PERSONALAPP_DEPLOY_ENV:-${DEFAULT_CONTEXT}}"
DRY_RUN=false

if [[ "${1:-}" == "--dry-run" ]]; then
    DRY_RUN=true
elif [[ $# -gt 0 ]]; then
    echo "Usage: ./deploy-personalapp.sh [--dry-run]" >&2
    exit 2
fi

if [[ ! -f "${CONFIG_FILE}" ]]; then
    echo "Missing personalApp deploy context: ${CONFIG_FILE}" >&2
    exit 1
fi

# shellcheck disable=SC1090
source "${CONFIG_FILE}"

required=(VPS_HOST VPS_USER VPS_PORT REMOTE_PATH)
for name in "${required[@]}"; do
    if [[ -z "${!name:-}" ]]; then
        echo "Missing ${name} in personalApp deploy context." >&2
        exit 1
    fi
done

if [[ "${REMOTE_PATH}" != "/www/wwwroot/myApps.com" ]]; then
    echo "Refusing to deploy: expected REMOTE_PATH=/www/wwwroot/myApps.com" >&2
    exit 1
fi
if [[ ! "${VPS_PORT}" =~ ^[0-9]+$ ]] || (( VPS_PORT < 1 || VPS_PORT > 65535 )); then
    echo "VPS_PORT is invalid." >&2
    exit 1
fi
if [[ -n "${SSH_KEY:-}" && ! -f "${SSH_KEY}" ]]; then
    echo "SSH key does not exist." >&2
    exit 1
fi

SOURCE_PATH="${SCRIPT_DIR}/php-dist/apps/harmonic-midi"
if [[ ! -f "${SOURCE_PATH}/index.html" || ! -f "${SOURCE_PATH}/api/install.php" ]]; then
    echo "Build package is missing. Run npm run build:php first." >&2
    exit 1
fi

release_id="$(date -u +%Y%m%d-%H%M%S)"
remote_apps="${REMOTE_PATH}/apps"
remote_target_path="${remote_apps}/harmonic-midi"
remote_stage="${remote_apps}/.harmonic-midi-incoming-${release_id}"
remote_backup="${remote_apps}/harmonic-midi.backup-${release_id}"
remote_host="${VPS_USER}@${VPS_HOST}"
control_path="/tmp/harmonic-midi-%C"

ssh_args=(-p "${VPS_PORT}" -o ConnectTimeout=12 -o ControlMaster=auto -o ControlPersist=60 -o "ControlPath=${control_path}")
rsync_ssh="ssh -p ${VPS_PORT} -o ConnectTimeout=12 -o ControlMaster=auto -o ControlPersist=60 -o ControlPath=${control_path}"
if [[ -n "${SSH_KEY:-}" ]]; then
    ssh_args+=(-i "${SSH_KEY}")
    rsync_ssh+=" -i ${SSH_KEY}"
fi

close_ssh_control() {
    ssh "${ssh_args[@]}" -O exit "${remote_host}" >/dev/null 2>&1 || true
}
trap close_ssh_control EXIT

echo "Scoped target: ${remote_target_path}"

if [[ "${DRY_RUN}" == true ]]; then
    rsync -azn --itemize-changes --exclude 'config.php' \
        -e "${rsync_ssh}" \
        "${SOURCE_PATH}/" "${remote_host}:${remote_target_path}/"
    echo "Dry run complete. No remote files were changed."
    exit 0
fi

ssh "${ssh_args[@]}" "${remote_host}" \
    "mkdir -p '${remote_apps}' && test ! -e '${remote_stage}' && mkdir '${remote_stage}'"

rsync -az --itemize-changes --exclude 'config.php' \
    -e "${rsync_ssh}" \
    "${SOURCE_PATH}/" "${remote_host}:${remote_stage}/"

ssh "${ssh_args[@]}" "${remote_host}" "
set -eu
if [ -f '${remote_target_path}/config.php' ]; then
    cp '${remote_target_path}/config.php' '${remote_stage}/config.php'
fi
find '${remote_stage}' -type f -name '*.php' -print0 | xargs -0 -n1 php -l >/dev/null
php '${remote_stage}/api/install.php'
chgrp www '${remote_stage}/config.php'
chmod 0640 '${remote_stage}/config.php'
if [ -e '${remote_target_path}' ]; then
    mv '${remote_target_path}' '${remote_backup}'
fi
if mv '${remote_stage}' '${remote_target_path}'; then
    echo 'Harmonic MIDI release activated.'
else
    if [ -e '${remote_backup}' ]; then
        mv '${remote_backup}' '${remote_target_path}'
    fi
    exit 1
fi
"

if [[ -n "${DEPLOY_URL:-}" ]]; then
    site_url="${DEPLOY_URL%/}"
    site_url="${site_url%/applist.php}"
    app_url="${site_url}/apps/harmonic-midi"
    health_response="$(curl --fail --silent --show-error --location --max-time 20 \
        "${app_url}/api/health.php")"
    if [[ "${health_response}" != *'"ok":true'* || "${health_response}" != *'"instruments":128'* ]]; then
        echo "Health endpoint returned an unexpected response." >&2
        exit 1
    fi
    echo "HTTP health check passed: ${app_url}/"
fi

echo "Deployment complete: ${release_id}"
echo "Rollback backup: ${remote_backup}"
