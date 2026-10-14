// Connecting a WhatsApp Business number through Meta's own window
// ("Embedded Signup", coexistence mode), for the Admins' WhatsApp card
// (WhatsAppIntegration.jsx) and agents connecting their own number
// (MyIntegrations.jsx).

// Facebook's sign-in script, loaded once (Meta's window needs it)
let facebook = null;
export function loadFacebook(appId, version) {
  facebook ??= new Promise((resolve, reject) => {
    window.fbAsyncInit = () => resolve(window.FB);
    const script = document.createElement("script");
    script.src = "https://connect.facebook.net/en_US/sdk.js";
    script.async = true;
    script.crossOrigin = "anonymous";
    script.onerror = () => {
      facebook = null;
      reject(
        new Error(
          "Facebook's sign-in didn't load. Check the connection, or turn off an ad blocker for this site.",
        ),
      );
    };
    document.body.appendChild(script);
  });
  return facebook.then((FB) => {
    FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
    return FB;
  });
}

// Meta's "Connect a number" window (Embedded Signup, for a number on the
// WhatsApp Business app). Resolves with { code, phoneNumberId, wabaId }
// for the server to finish connecting. Also used by MyIntegrations.jsx,
// where agents connect their own number. Must be called straight from a
// click (browsers block pop-ups that open later).
export function embeddedSignup(fb, configId) {
  return new Promise((resolve, reject) => {
    // Meta's window tells this page which number was connected,
    // separately from the sign-in code
    let session = null;
    const listen = (event) => {
      let host;
      try {
        host = new URL(event.origin).hostname;
      } catch {
        return;
      }
      if (!/(^|\.)facebook\.com$/.test(host)) return;
      let data = event.data;
      if (typeof data === "string") {
        try {
          data = JSON.parse(data);
        } catch {
          return;
        }
      }
      if (data?.type !== "WA_EMBEDDED_SIGNUP") return;
      if (String(data.event).startsWith("FINISH")) session = data.data ?? {};
      else if (data.event === "CANCEL") session = { cancelled: true, step: data.data?.current_step };
      else if (data.event === "ERROR") session = { error: data.data?.error_message };
    };
    window.addEventListener("message", listen);
    fb.login(
      (response) => {
        // The number's details can arrive just after this
        setTimeout(() => {
          window.removeEventListener("message", listen);
          const code = response?.authResponse?.code;
          if (session?.error) return reject(new Error(`Meta said: ${session.error}`));
          if (!code || session?.cancelled)
            return reject(new Error("The window was closed before the end, so nothing was connected."));
          if (!session?.phone_number_id)
            return reject(
              new Error("Meta didn't say which number was connected. Try again, and go through every step."),
            );
          resolve({ code, phoneNumberId: session.phone_number_id, wabaId: session.waba_id });
        }, 1500);
      },
      {
        config_id: configId,
        response_type: "code",
        override_default_response_type: true,
        extras: {
          setup: {},
          featureType: "whatsapp_business_app_onboarding",
          sessionInfoVersion: "3",
        },
      },
    );
  });
}
