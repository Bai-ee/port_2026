// Retired route — the Video Remix studio is now a tab of the one universal
// Studio (`/dashboard/studio?tool=remix`, component
// ../studio/remix/RemixStudio.jsx), so it inherits the shared shell, tool
// switcher, rail UI, and per-tool social preview instead of carrying its own
// copy of all of it.
//
// Kept as a permanent redirect so existing links and bookmarks still land on
// the tool.
import { redirect } from 'next/navigation';

export default function VideoRemixStudioRedirect() {
  redirect('/dashboard/studio?tool=remix');
}
