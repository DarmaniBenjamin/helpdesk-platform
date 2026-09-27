import { useRef, useState } from "react";
import {
  Camera,
  Trash2,
  Mail,
  Phone,
  CalendarDays,
  CircleCheck,
  Upload,
} from "lucide-react";
import Avatar from "../Avatar";
import PasswordCard from "../PasswordCard";
import RoleBadge from "../RoleBadge";
import {
  inputClass,
  labelClass,
  primaryButton,
  secondaryButton,
} from "../formStyles";
import { MAX_PHOTO_BYTES, resizeImage } from "../imageUtils";
import useData from "../../useData";

// Your own profile: photo, name, email and phone.
// Every staff member and customer gets this same page for themselves.
export default function Profile() {
  const { me, updateMember, findMemberByEmail } = useData();
  const fileInput = useRef(null);

  // The form starts with what's saved
  const [name, setName] = useState(me.name);
  const [email, setEmail] = useState(me.email);
  const [phone, setPhone] = useState(me.phone ?? "");
  const [emailError, setEmailError] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState("");

  const isStaff = me.role !== "customer";
  const changed =
    name.trim() !== me.name ||
    email.trim().toLowerCase() !== me.email ||
    phone.trim() !== (me.phone ?? "");

  // ----- Photo -----

  async function handlePhotoPicked(e) {
    const file = e.target.files[0];
    e.target.value = ""; // so picking the same file again still works
    if (!file) return;

    if (!file.type.startsWith("image/")) {
      setPhotoError("Please pick an image file (JPG, PNG, WebP or GIF).");
      return;
    }
    if (file.size > MAX_PHOTO_BYTES) {
      setPhotoError("That image is over 5 MB. Please pick a smaller one.");
      return;
    }

    try {
      const photo = await resizeImage(file);
      await updateMember(me.id, { photo }); // saves to the database
      setPhotoError("");
    } catch (err) {
      setPhotoError(err.message);
    }
  }

  async function removePhoto() {
    try {
      await updateMember(me.id, { photo: null });
      setPhotoError("");
    } catch (err) {
      setPhotoError(err.message);
    }
  }

  // ----- Details form -----

  async function handleSubmit(e) {
    e.preventDefault();
    const cleanEmail = email.trim().toLowerCase();
    setSaveError("");

    // Nobody else can already sign in with this email (the server
    // checks this too, against everyone)
    const owner = findMemberByEmail(cleanEmail);
    if (owner && owner.id !== me.id) {
      setEmailError("Someone else already uses this email.");
      return;
    }

    setSaving(true);
    try {
      await updateMember(me.id, {
        name: name.trim(),
        email: cleanEmail,
        phone: phone.trim(),
      });
      document.activeElement?.blur();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err) {
      if (err.status === 409) setEmailError(err.message);
      else setSaveError(err.message);
    } finally {
      setSaving(false);
    }
  }

  function discardChanges() {
    setName(me.name);
    setEmail(me.email);
    setPhone(me.phone ?? "");
    setEmailError("");
  }

  const memberSince = me.joinedAt
    ? new Date(me.joinedAt).toLocaleDateString("en-US", {
        month: "long",
        year: "numeric",
      })
    : null;

  return (
    <div className="flex flex-col gap-4 sm:gap-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold sm:text-3xl">My profile</h1>
        <p className="mt-1 text-sm text-muted">
          {isStaff
            ? "This is how you show up to your team and customers."
            : "This is how you show up to our support team."}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:gap-6 lg:grid-cols-3">
        {/* Left: photo and summary */}
        <div className="flex flex-col gap-4 sm:gap-6">
          <div className="rounded-xl border border-line bg-white p-5">
            <div className="flex flex-col items-center text-center">
              {/* The photo, with a camera button on top to change it */}
              <div className="relative">
                <Avatar name={me.name} photo={me.photo} size="lg" />
                <button
                  type="button"
                  aria-label="Change photo"
                  onClick={() => fileInput.current.click()}
                  className="absolute -left-1 bottom-0 flex h-9 w-9 cursor-pointer items-center justify-center rounded-full border-2 border-white bg-brand text-white shadow transition hover:bg-brand/90 active:scale-[0.92]"
                >
                  <Camera className="h-4 w-4" />
                </button>
              </div>
              <input
                ref={fileInput}
                type="file"
                accept="image/*"
                onChange={handlePhotoPicked}
                className="hidden"
              />

              <p className="mt-4 text-lg font-semibold">{me.name}</p>
              <div className="mt-1.5">
                <RoleBadge role={me.role} />
              </div>

              {/* Phones: stacked full-width buttons (a grid, so each keeps
                  its full height). Tablets: side by side. Desktop: stacked. */}
              <div className="mt-4 grid w-full gap-2 sm:flex sm:justify-center lg:grid">
                <button
                  type="button"
                  onClick={() => fileInput.current.click()}
                  className={`${secondaryButton} flex items-center justify-center gap-2`}
                >
                  <Upload className="h-4 w-4" />
                  {me.photo ? "Change photo" : "Upload photo"}
                </button>
                {me.photo && (
                  <button
                    type="button"
                    onClick={removePhoto}
                    className="flex h-11 cursor-pointer items-center justify-center gap-2 rounded-lg px-4 text-sm text-red-500 transition hover:bg-red-50 active:scale-[0.97]"
                  >
                    <Trash2 className="h-4 w-4" />
                    Remove photo
                  </button>
                )}
              </div>
              <p
                className={`mt-2 text-xs ${photoError ? "text-red-500" : "text-muted"}`}
              >
                {photoError || "A square photo works best. Max 5 MB."}
              </p>
            </div>

            <dl className="mt-5 flex flex-col gap-3 border-t border-line pt-4 text-sm">
              <div className="flex items-center gap-3">
                <dt className="sr-only">Email</dt>
                <Mail className="h-4 w-4 shrink-0 text-muted" />
                <dd className="min-w-0 truncate">{me.email}</dd>
              </div>
              <div className="flex items-center gap-3">
                <dt className="sr-only">Phone</dt>
                <Phone className="h-4 w-4 shrink-0 text-muted" />
                <dd className={me.phone ? "" : "text-muted"}>
                  {me.phone || "No phone number"}
                </dd>
              </div>
              {memberSince && (
                <div className="flex items-center gap-3">
                  <dt className="sr-only">Member since</dt>
                  <CalendarDays className="h-4 w-4 shrink-0 text-muted" />
                  <dd>Member since {memberSince}</dd>
                </div>
              )}
            </dl>
          </div>
        </div>

        {/* Right: the details form, and password */}
        <div className="flex flex-col gap-4 sm:gap-6 lg:col-span-2">
          <form
            onSubmit={handleSubmit}
            className="rounded-xl border border-line bg-white p-5"
          >
            <h2 className="text-lg font-semibold">Personal details</h2>
            <p className="mt-1 text-sm text-muted">
              Your name shows on the replies and notes you write.
            </p>

            <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
              <label className={`${labelClass} sm:col-span-2`}>
                Full name
                <input
                  required
                  autoComplete="name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className={inputClass}
                />
              </label>

              <label className={labelClass}>
                Email address
                <input
                  required
                  type="email"
                  autoComplete="email"
                  value={email}
                  onChange={(e) => {
                    setEmail(e.target.value);
                    setEmailError("");
                  }}
                  className={`${inputClass} ${emailError ? "border-red-400" : ""}`}
                />
                <span
                  className={`text-xs font-normal ${emailError ? "text-red-500" : "text-muted"}`}
                >
                  {emailError || "You'll sign in with this."}
                </span>
              </label>

              <label className={labelClass}>
                <span>
                  Phone number{" "}
                  <span className="font-normal text-muted">(optional)</span>
                </span>
                <input
                  type="tel"
                  inputMode="tel"
                  autoComplete="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="+1 (473) 000-0000"
                  className={inputClass}
                />
              </label>
            </div>

            {/* Phones: full-width buttons with Save on top. From 640px up:
                a row on the right, with Save last. */}
            <div className="mt-6 grid gap-2 border-t border-line pt-4 sm:flex sm:items-center sm:justify-end">
              {saved && (
                <span className="order-last flex items-center justify-center gap-1.5 text-sm font-medium text-brand sm:order-first sm:mr-auto">
                  <CircleCheck className="h-4 w-4" />
                  Changes saved
                </span>
              )}
              {saveError && (
                <span className="order-last text-center text-sm text-red-500 sm:order-first sm:mr-auto sm:text-left">
                  {saveError}
                </span>
              )}
              <button
                type="button"
                onClick={discardChanges}
                disabled={!changed}
                className={`${secondaryButton} disabled:cursor-default disabled:opacity-50 disabled:hover:border-line disabled:hover:text-ink`}
              >
                Discard
              </button>
              <button
                type="submit"
                disabled={!changed || saving}
                className={`${primaryButton} order-first sm:order-last disabled:cursor-default disabled:opacity-50 disabled:hover:bg-brand`}
              >
                {saving ? "Saving…" : "Save changes"}
              </button>
            </div>
          </form>

          <PasswordCard />
        </div>
      </div>
    </div>
  );
}
