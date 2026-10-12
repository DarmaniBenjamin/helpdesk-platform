#!/usr/bin/env bash
# =====================================================================
#  FreePBX / Asterisk: send each new voicemail to the helpdesk
# =====================================================================
# Each new voicemail (with its recording) goes to the helpdesk's call
# webhook, and becomes a ticket for the agent whose extension it is.
# (Integrations → Phone. Emailing voicemails works too, without this.)
#
# Install, on the phone system (as root):
#   1. Copy this file to /var/lib/asterisk/bin/uplink-voicemail.sh
#        chmod 755 /var/lib/asterisk/bin/uplink-voicemail.sh
#   2. Put the webhook address from Integrations → Phone in
#      /etc/uplink-pbx.conf:
#        HOOK_URL="https://your-helpdesk/api/phone/hook/xxxxxxxx"
#        chmod 640 /etc/uplink-pbx.conf; chown root:asterisk /etc/uplink-pbx.conf
#   3. FreePBX: Settings → Voicemail Admin → Settings → General, set
#      "External Notify" (externnotify) to
#        /var/lib/asterisk/bin/uplink-voicemail.sh
#      Submit and Apply Config. (Plain Asterisk: externnotify= in the
#      [general] section of voicemail.conf, then "voicemail reload".)
#   4. Leave yourself a test voicemail.
#
# Asterisk runs this whenever a mailbox changes, with: context, mailbox,
# new message count... It sends the newest message once (it remembers
# what it already sent in /var/spool/asterisk/uplink-sent).
# =====================================================================
set -u

CONTEXT="${1:-default}"
MAILBOX="${2:-}"
[[ -n "$MAILBOX" ]] || exit 0

# shellcheck disable=SC1091
source /etc/uplink-pbx.conf 2>/dev/null || exit 0
[[ -n "${HOOK_URL:-}" ]] || exit 0

INBOX="/var/spool/asterisk/voicemail/$CONTEXT/$MAILBOX/INBOX"
SENT_DIR="/var/spool/asterisk/uplink-sent"
mkdir -p "$SENT_DIR" 2>/dev/null

# The newest message in the mailbox
INFO="$(ls -t "$INBOX"/msg*.txt 2>/dev/null | head -n 1)"
[[ -n "$INFO" ]] || exit 0
BASE="${INFO%.txt}"

value() { grep -m1 "^$1=" "$INFO" | cut -d= -f2-; }
MSG_ID="$(value msg_id)"
[[ -n "$MSG_ID" ]] || MSG_ID="$MAILBOX-$(basename "$BASE")-$(value origtime)"

# Already sent?
MARK="$SENT_DIR/$(echo "$MSG_ID" | tr -c 'A-Za-z0-9._-' '_')"
[[ -e "$MARK" ]] && exit 0

# callerid="Keisha Charles" <4735551234>
CALLERID="$(value callerid)"
NUMBER="$(echo "$CALLERID" | sed -n 's/.*<\([^>]*\)>.*/\1/p')"
[[ -n "$NUMBER" ]] || NUMBER="$CALLERID"
NAME="$(echo "$CALLERID" | sed -n 's/^"\{0,1\}\([^"<]*\)"\{0,1\} *<.*/\1/p' | sed 's/ *$//')"
DURATION="$(value duration)"

# The recording: wav first, else whatever format the voicemail is in
AUDIO=""
for ext in wav WAV mp3 gsm; do
  [[ -f "$BASE.$ext" ]] && { AUDIO="$BASE.$ext"; break; }
done

ARGS=(-fsS --max-time 120
  -F "event=voicemail"
  -F "number=$NUMBER"
  -F "name=$NAME"
  -F "ext=$MAILBOX"
  -F "duration=$DURATION"
  -F "id=vm-$MSG_ID")
[[ -n "$AUDIO" ]] && ARGS+=(-F "recording=@$AUDIO")

# In the background, so Asterisk isn't kept waiting
(
  if curl "${ARGS[@]}" "$HOOK_URL" >/dev/null; then
    touch "$MARK"
  else
    logger -t uplink-voicemail "Couldn't send voicemail $MSG_ID to the helpdesk"
  fi
  # Forget what was sent after 30 days
  find "$SENT_DIR" -type f -mtime +30 -delete 2>/dev/null
) &
exit 0
