"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { signOut, useSession } from "next-auth/react";

const heading = "var(--font-heading)";

const NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    label: "My Worlds",
    href: "/dashboard/worlds",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    label: "Explore",
    href: "/dashboard/explore",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
];

function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const { data: session } = useSession();
  const overlayRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center md:items-center">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div
        ref={overlayRef}
        className="relative z-10 w-full rounded-t-[20px] border-t border-white/8 bg-[#161616] px-5 pb-10 pt-6 shadow-2xl md:max-w-lg md:rounded-2xl md:border md:p-8"
      >
        {/* Mobile drag handle */}
        <div className="mb-5 flex justify-center md:hidden">
          <div className="h-1 w-9 rounded-full bg-white/15" />
        </div>

        <div className="flex items-center justify-between">
          <h2
            className="text-xl font-semibold text-white"
            style={{ fontFamily: heading }}
          >
            Settings
          </h2>
          <button
            onClick={onClose}
            className="rounded-lg p-1.5 text-white/40 transition-colors hover:bg-white/5 hover:text-white/70"
          >
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="mt-6 flex flex-col gap-6">
          {/* Profile */}
          <div className="flex flex-col gap-2">
            <label className="text-[10px] uppercase tracking-[0.15em] text-white/35" style={{ fontFamily: "var(--font-mono)" }}>
              Profile
            </label>
            <div className="rounded-xl border border-white/6 bg-white/[0.03] p-4 md:p-5">
              <div className="flex items-center gap-3">
                {session?.user?.image ? (
                  <Image
                    src={session.user.image}
                    alt=""
                    width={44}
                    height={44}
                    className="shrink-0 rounded-full"
                  />
                ) : (
                  <div className="h-11 w-11 shrink-0 rounded-full bg-gradient-to-br from-[#1a4a45] to-[#8fd1cb]" />
                )}
                <div className="flex flex-col gap-0.5">
                  <span className="text-[15px] font-semibold text-white/90" style={{ fontFamily: heading }}>
                    {session?.user?.name ?? "User"}
                  </span>
                  <span className="text-xs text-white/40 md:text-[13px]">
                    {session?.user?.email}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Sign out — mobile only (desktop has it in sidebar menu) */}
          <button
            onClick={() => signOut({ callbackUrl: "/" })}
            className="flex items-center justify-center gap-2 rounded-xl border border-white/6 bg-white/[0.03] py-3.5 text-sm font-medium text-red-400/70 transition-colors hover:text-red-400 md:hidden"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" x2="9" y1="12" y2="12" />
            </svg>
            Sign out
          </button>
        </div>
      </div>
    </div>
  );
}

function ProfileMenu() {
  const { data: session } = useSession();
  const [menuOpen, setMenuOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const closeMenu = useCallback(() => setMenuOpen(false), []);

  useEffect(() => {
    if (!menuOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        closeMenu();
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen, closeMenu]);

  if (!session?.user) return null;

  return (
    <>
      <div ref={menuRef} className="relative">
        {/* Profile Button */}
        <button
          onClick={() => setMenuOpen((prev) => !prev)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-white/6 bg-white/[0.03] px-3 py-3 transition-colors hover:bg-white/[0.06]"
        >
          {session.user.image ? (
            <Image
              src={session.user.image}
              alt=""
              width={32}
              height={32}
              className="shrink-0 rounded-full"
            />
          ) : (
            <div className="h-8 w-8 shrink-0 rounded-full bg-gradient-to-br from-[#1a4a45] to-[#8fd1cb]" />
          )}
          <div className="flex flex-1 flex-col items-start gap-px overflow-hidden">
            <span className="truncate text-[13px] font-medium text-white/80">
              {session.user.name ?? "User"}
            </span>
            <span className="truncate text-[11px] text-white/35">
              {session.user.email}
            </span>
          </div>
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinecap="round"
            className={`shrink-0 text-white/25 transition-transform ${menuOpen ? "rotate-180" : ""}`}
          >
            <path d="m18 15-6-6-6 6" />
          </svg>
        </button>

        {/* Dropdown Menu */}
        {menuOpen && (
          <div className="absolute bottom-full left-0 mb-2 w-full overflow-hidden rounded-xl border border-white/8 bg-[#1a1a1a] shadow-xl">
            <button
              onClick={() => {
                setMenuOpen(false);
                setSettingsOpen(true);
              }}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-white/60 transition-colors hover:bg-white/5 hover:text-white/90"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
                <circle cx="12" cy="12" r="3" />
              </svg>
              Settings
            </button>
            <div className="border-t border-white/6" />
            <button
              onClick={() => signOut({ callbackUrl: "/" })}
              className="flex w-full items-center gap-2.5 px-3.5 py-2.5 text-left text-sm text-red-400/70 transition-colors hover:bg-white/5 hover:text-red-400"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                <polyline points="16 17 21 12 16 7" />
                <line x1="21" x2="9" y1="12" y2="12" />
              </svg>
              Sign out
            </button>
          </div>
        )}
      </div>

      {/* Settings Overlay */}
      {settingsOpen && <SettingsOverlay onClose={() => setSettingsOpen(false)} />}
    </>
  );
}

const MOBILE_NAV_ITEMS = [
  {
    label: "Dashboard",
    href: "/dashboard",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <rect x="3" y="3" width="7" height="7" rx="1" />
        <rect x="14" y="3" width="7" height="7" rx="1" />
        <rect x="3" y="14" width="7" height="7" rx="1" />
        <rect x="14" y="14" width="7" height="7" rx="1" />
      </svg>
    ),
  },
  {
    label: "Worlds",
    href: "/dashboard/worlds",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="12" r="10" />
        <path d="M2 12h20" />
        <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
      </svg>
    ),
  },
  {
    label: "Explore",
    href: "/dashboard/explore",
    icon: (
      <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.35-4.35" />
      </svg>
    ),
  },
];

function MobileTopBar() {
  const { data: session } = useSession();

  return (
    <div className="flex items-center justify-between px-5 py-4 md:hidden">
      <Link href="/" className="flex items-center gap-2">
        <svg width="24" height="10" viewBox="0 0 1253 552" fill="none">
          <path d="M546.047 167.264C536.748 173.082 520.508 183.309 512.311 189.963C578.447 158.716 640.463 131.927 712.011 112.485C789.513 91.6036 872.254 73.6171 952.815 78.6919C1009 82.2315 1023.71 106.767 977.448 145.978C918.626 195.839 844.995 233.131 775.316 265.992C668.19 315.561 558.614 359.662 447.015 398.124C423.46 406.475 399.821 414.589 376.104 422.467C365.211 426.068 350.785 431.209 339.929 433.914C349.11 429.416 362.505 424.319 372.352 420.133L436.916 392.495C497.647 366.373 558.05 339.497 618.113 311.872L617.721 310.725C556.842 336.257 495.27 360.113 433.078 382.264C415.881 388.481 398.615 394.504 381.282 400.333C372.764 403.239 357.321 408.775 348.761 410.515C394.029 390.182 437.861 371.218 482.997 349.87L481.608 348.6C401.07 383.238 319.612 415.695 237.322 445.937C211.986 455.356 186.565 464.549 161.065 473.515C151.192 476.989 131.532 484.336 121.938 486.82L123.286 488.059C144.465 481.397 167.846 475.355 189.349 469.152C224.934 458.783 260.348 447.835 295.577 436.313C300.048 434.825 304.612 434.009 309.267 432.425C309.34 432.397 309.4 432.376 309.444 432.365C309.385 432.385 309.326 432.405 309.267 432.425C308.39 432.769 305.612 434.269 304.738 434.651C297.707 437.732 290.538 440.322 283.421 443.207L220.921 467.825C147.612 496.268 73.9668 523.836 0 550.523L1.2155 551.713C7.71857 550.248 17.2349 547.162 23.8157 545.257L68.0639 532.447C107.979 521.114 147.982 510.087 188.066 499.368C229.986 487.995 272.003 476.986 314.115 466.343C364.355 453.897 413.647 442.62 463.908 429.408C488.553 422.968 513.112 416.198 537.577 409.101C550.896 405.241 569.354 399.162 582.411 396.39C510.43 430.934 421.953 457.546 345.135 477.587L345.701 478.839C354.186 477.559 369.467 473.83 378.097 471.876C398.096 467.391 418.04 462.668 437.927 457.709C536.288 433.136 637.356 402.314 730.849 362.759L730.464 361.547C684.216 379.574 637.239 395.684 589.663 409.837C571.722 415.289 544.719 424.029 526.568 427.61C565.454 410.989 605.119 397.217 643.09 378.05C654.433 372.323 674.446 366.695 686.973 362.335C707.151 355.294 727.233 347.964 747.205 340.348C838.071 305.741 929.378 264.953 1013.32 215.832C1036.47 202.285 1332.77 16.0042 1231.67 2.96727C1194.12 -1.87509 1145.87 0.366926 1108 1.66091C929.963 7.74303 768.93 45.978 611.086 129.472C588.954 141.273 567.26 153.879 546.047 167.264Z" fill="white" />
        </svg>
        <span className="text-base font-bold tracking-tight text-white" style={{ fontFamily: heading }}>
          Odyssey
        </span>
      </Link>
      {session?.user?.image ? (
        <Image src={session.user.image} alt="" width={32} height={32} className="rounded-full" />
      ) : (
        <div className="h-8 w-8 rounded-full bg-gradient-to-br from-[#1a4a45] to-[#8fd1cb]" />
      )}
    </div>
  );
}

function MobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 flex items-center justify-around border-t border-white/6 bg-[#0a0a0a] px-2 pb-7 pt-3 md:hidden">
      {MOBILE_NAV_ITEMS.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex flex-col items-center gap-1 ${
              active ? "text-[#8fd1cb]" : "text-white/35"
            }`}
          >
            {item.icon}
            <span className={`text-[10px] ${active ? "font-medium" : ""}`}>
              {item.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}

export function DashboardSidebar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop Sidebar */}
      <aside className="hidden h-screen w-60 flex-shrink-0 flex-col justify-between border-r border-white/6 bg-[#111111] px-5 py-6 md:flex">
        <div className="flex flex-col gap-8">
          <Link href="/" className="flex items-center gap-2 px-1">
            <svg width="32" height="14" viewBox="0 0 1253 552" fill="none">
              <path d="M546.047 167.264C536.748 173.082 520.508 183.309 512.311 189.963C578.447 158.716 640.463 131.927 712.011 112.485C789.513 91.6036 872.254 73.6171 952.815 78.6919C1009 82.2315 1023.71 106.767 977.448 145.978C918.626 195.839 844.995 233.131 775.316 265.992C668.19 315.561 558.614 359.662 447.015 398.124C423.46 406.475 399.821 414.589 376.104 422.467C365.211 426.068 350.785 431.209 339.929 433.914C349.11 429.416 362.505 424.319 372.352 420.133L436.916 392.495C497.647 366.373 558.05 339.497 618.113 311.872L617.721 310.725C556.842 336.257 495.27 360.113 433.078 382.264C415.881 388.481 398.615 394.504 381.282 400.333C372.764 403.239 357.321 408.775 348.761 410.515C394.029 390.182 437.861 371.218 482.997 349.87L481.608 348.6C401.07 383.238 319.612 415.695 237.322 445.937C211.986 455.356 186.565 464.549 161.065 473.515C151.192 476.989 131.532 484.336 121.938 486.82L123.286 488.059C144.465 481.397 167.846 475.355 189.349 469.152C224.934 458.783 260.348 447.835 295.577 436.313C300.048 434.825 304.612 434.009 309.267 432.425C309.34 432.397 309.4 432.376 309.444 432.365C309.385 432.385 309.326 432.405 309.267 432.425C308.39 432.769 305.612 434.269 304.738 434.651C297.707 437.732 290.538 440.322 283.421 443.207L220.921 467.825C147.612 496.268 73.9668 523.836 0 550.523L1.2155 551.713C7.71857 550.248 17.2349 547.162 23.8157 545.257L68.0639 532.447C107.979 521.114 147.982 510.087 188.066 499.368C229.986 487.995 272.003 476.986 314.115 466.343C364.355 453.897 413.647 442.62 463.908 429.408C488.553 422.968 513.112 416.198 537.577 409.101C550.896 405.241 569.354 399.162 582.411 396.39C510.43 430.934 421.953 457.546 345.135 477.587L345.701 478.839C354.186 477.559 369.467 473.83 378.097 471.876C398.096 467.391 418.04 462.668 437.927 457.709C536.288 433.136 637.356 402.314 730.849 362.759L730.464 361.547C684.216 379.574 637.239 395.684 589.663 409.837C571.722 415.289 544.719 424.029 526.568 427.61C565.454 410.989 605.119 397.217 643.09 378.05C654.433 372.323 674.446 366.695 686.973 362.335C707.151 355.294 727.233 347.964 747.205 340.348C838.071 305.741 929.378 264.953 1013.32 215.832C1036.47 202.285 1332.77 16.0042 1231.67 2.96727C1194.12 -1.87509 1145.87 0.366926 1108 1.66091C929.963 7.74303 768.93 45.978 611.086 129.472C588.954 141.273 567.26 153.879 546.047 167.264Z" fill="white" />
            </svg>
            <span className="text-lg font-bold tracking-tight text-white" style={{ fontFamily: heading }}>
              Odyssey
            </span>
          </Link>

          <nav className="flex flex-col gap-0.5">
            {NAV_ITEMS.map((item) => {
              const active = pathname === item.href;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-sm transition-colors ${
                    active
                      ? "bg-[#8fd1cb]/10 font-medium text-[#8fd1cb]"
                      : "text-white/50 hover:bg-white/5 hover:text-white/70"
                  }`}
                >
                  {item.icon}
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </div>

        <ProfileMenu />
      </aside>

      {/* Mobile Top Bar */}
      <MobileTopBar />

      {/* Mobile Bottom Nav */}
      <MobileBottomNav />
    </>
  );
}
