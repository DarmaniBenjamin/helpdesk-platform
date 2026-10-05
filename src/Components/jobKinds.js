import { MapPin, MonitorSmartphone, Phone } from "lucide-react";

// The kinds of job on the calendar, with their icons (server/src/jobs.js)
export const JOB_KINDS = {
  onsite: { label: "On site", icon: MapPin },
  remote: { label: "Remote", icon: MonitorSmartphone },
  call: { label: "Call", icon: Phone },
};
