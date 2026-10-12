#!/usr/bin/env bash
# =====================================================================
#  FreePBX / Asterisk: send each recorded call to the helpdesk
# =====================================================================
# When a recorded call ends, its recording goes to the helpdesk's call
# webhook and is attached to the caller's open ticket (or a new one), to
# play back. (Integrations → Phone → "Recorded calls go on tickets".)
#
# Install, on the phone system (as root):
#   1. Copy this file to /var/lib/asterisk/bin/uplink-call-recording.sh
#        chmod 755 /var/lib/asterisk/bin/uplink-call-recording.sh
#   2. The webhook address in /etc/uplink-pbx.conf (the same file as the
#      voicemail script uses):
#        HOOK_URL="https://your-helpdesk/api/phone/hook/xxxxxxxx"
#   3. Turn on call recording where you want it (FreePBX: each
#      extension's "Recording Options", Inbound Routes, Queues...).
#   4. FreePBX: Settings → Advanced Settings → "Post Call Recording
#      Script", all on one line:
#        /var/lib/asterisk/bin/uplink-call-recording.sh ^{MIXMON_DIR}^{YEAR}/^{MONTH}/^{DAY}/^{CALLFILENAME}.^{MIXMON_FORMAT} ^{CALLFILENAME} ^{CDR(src)} ^{CDR(dst)} ^{CDR(dstchannel)} ^{CDR(billsec)} ^{UNIQUEID}
#      Submit and Apply Config.
#   5. Make a test call to a customer's number that's in the helpdesk.
#
# Which calls are sent: calls with outside numbers, in and out
# (FreePBX names those recordings in-..., out-... and q-... for queues).
# Calls between two extensions (exten-...) are left alone.
# =====================================================================
set -u

FILE="${1:-}"
CALLFILENAME="${2:-}"
SRC="${3:-}"
DST="${4:-}"
DSTCHANNEL="${5:-}"
BILLSEC="${6:-}"
UNIQUEID="${7:-}"

# shellcheck disable=SC1091
source /etc/uplink-pbx.conf 2>/dev/null || exit 0
[[ -n "${HOOK_URL:-}" && -n "$FILE" ]] || exit 0

# Calls between two extensions aren't for tickets
case "$CALLFILENAME" in
  out-*) DIRECTION=out ;;
  in-* | q-* | external-*) DIRECTION=in ;;
  *) exit 0 ;;
esac

# MIXMON_DIR is empty when recordings are in the usual folder
[[ "$FILE" = /* ]] || FILE="/var/spool/asterisk/monitor/$FILE"

# PJSIP/204-00000012 -> 204
channel_ext() { echo "$1" | sed -n 's#^[A-Za-z]*/\([0-9]\{2,6\}\)[-@].*#\1#p'; }

if [[ "$DIRECTION" == out ]]; then
  NUMBER="$DST"   # the outside number that was called
  EXT="$SRC"      # the extension that called it
else
  NUMBER="$SRC"   # the outside caller
  EXT="$(channel_ext "$DSTCHANNEL")"
fi

# In the background, once the recording file is finished, so Asterisk
# isn't kept waiting
(
  for _ in 1 2 3 4 5 6 7 8 9 10; do
    [[ -s "$FILE" ]] && break
    sleep 1
  done
  [[ -s "$FILE" ]] || exit 0
  # Very short calls (under 5 seconds) aren't worth a recording
  [[ -z "$BILLSEC" || "$BILLSEC" -ge 5 ]] 2>/dev/null || exit 0
  curl -fsS --max-time 300 \
    -F "event=answered" \
    -F "direction=$DIRECTION" \
    -F "number=$NUMBER" \
    -F "ext=$EXT" \
    -F "duration=$BILLSEC" \
    -F "id=rec-$UNIQUEID" \
    -F "recording=@$FILE" \
    "$HOOK_URL" >/dev/null ||
    logger -t uplink-call-recording "Couldn't send $FILE to the helpdesk"
) </dev/null >/dev/null 2>&1 &
exit 0
