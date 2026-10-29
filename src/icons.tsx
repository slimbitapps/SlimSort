import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base(paths: React.ReactNode) {
  return function Icon({ size = 18, ...rest }: P) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.8}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden="true"
        {...rest}
      >
        {paths}
      </svg>
    );
  };
}

export const IconGrid = base(<><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></>);
export const IconImage = base(<><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="9" cy="10" r="2" /><path d="m21 16-5-5L5 20" /></>);
export const IconUndo = base(<><path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-3" /></>);
export const IconSkip = base(<><path d="m5 4 10 8-10 8V4z" /><path d="M19 5v14" /></>);
export const IconTrash = base(<><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M19 6l-1 14H6L5 6" /><path d="M10 11v6M14 11v6" /></>);
export const IconFolder = base(<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />);
export const IconFolderPlus = base(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><path d="M12 10v6M9 13h6" /></>);
export const IconFolderOut = base(<><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" /><path d="M10 13h6M13 10l3 3-3 3" /></>);
export const IconMaximize = base(<><path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3" /></>);
export const IconMinimize = base(<><path d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3" /></>);
export const IconEye = base(<><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z" /><circle cx="12" cy="12" r="3" /></>);
export const IconHome = base(<><path d="m3 11 9-8 9 8" /><path d="M5 10v10h14V10" /></>);
export const IconSun = base(<><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></>);
export const IconMoon = base(<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />);
export const IconMenu = base(<><path d="M4 6h16M4 12h16M4 18h16" /></>);
export const IconHelp = base(<><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6V14" /><path d="M12 17.5h.01" /></>);
export const IconClose = base(<><path d="M6 6l12 12M18 6 6 18" /></>);
export const IconPlus = base(<><path d="M12 5v14M5 12h14" /></>);
export const IconPlay = base(<path d="M7 4v16l13-8L7 4z" />);
export const IconSettings = base(<><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" /></>);
export const IconKeyboard = base(<><rect x="2" y="6" width="20" height="12" rx="2" /><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10" /></>);
export const IconInfo = base(<><circle cx="12" cy="12" r="9" /><path d="M12 11v6M12 7.5h.01" /></>);
export const IconLayers = base(<><path d="m12 3 9 5-9 5-9-5 9-5z" /><path d="m3 13 9 5 9-5" /></>);
export const IconSearch = base(<><circle cx="11" cy="11" r="7" /><path d="m20 20-4-4" /></>);
export const IconChart = base(<><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></>);
export const IconArrowDown = base(<><path d="M12 5v14M6 13l6 6 6-6" /></>);
export const IconArrowUp = base(<><path d="M12 19V5M6 11l6-6 6 6" /></>);
export const IconChevronLeft = base(<path d="m15 18-6-6 6-6" />);
export const IconChevronRight = base(<path d="m9 18 6-6-6-6" />);
export const IconChevronDown = base(<path d="m6 9 6 6 6-6" />);
export const IconCopy = base(<><rect x="9" y="9" width="12" height="12" rx="2" /><path d="M5 15V5a2 2 0 0 1 2-2h10" /></>);
export const IconMove = base(<><path d="M5 12h14M13 6l6 6-6 6" /></>);
export const IconVideo = base(<><rect x="2" y="6" width="14" height="12" rx="2" /><path d="m16 10 6-3v10l-6-3" /></>);
export const IconLive = base(<><circle cx="12" cy="12" r="3" /><circle cx="12" cy="12" r="6.5" strokeDasharray="2 2" /><circle cx="12" cy="12" r="10" /></>);
export const IconWarning = base(<><path d="M12 3 2 21h20L12 3z" /><path d="M12 10v5M12 18h.01" /></>);
export const IconCheck = base(<path d="m5 12 5 5 9-10" />);
export const IconSparkle = base(<path d="M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8L12 3z" />);
export const IconUser = base(<><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0 1 16 0" /></>);
export const IconGlobe = base(<><circle cx="12" cy="12" r="9" /><path d="M3 12h18M12 3c2.5 2.6 3.8 5.6 3.8 9s-1.3 6.4-3.8 9c-2.5-2.6-3.8-5.6-3.8-9S9.5 5.6 12 3z" /></>);
export const IconPalette = base(<><path d="M12 3a9 9 0 1 0 0 18c1.1 0 1.6-.8 1.6-1.6 0-.5-.2-.9-.5-1.2-.3-.4-.5-.8-.5-1.3 0-.9.7-1.6 1.6-1.6H16a5 5 0 0 0 5-5C21 6.4 17 3 12 3z" /><circle cx="7.5" cy="11" r="1.2" /><circle cx="10" cy="7" r="1.2" /><circle cx="14.5" cy="7" r="1.2" /></>);
export const IconSliders = base(<><path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0" /><circle cx="16" cy="6" r="2" /><circle cx="10" cy="12" r="2" /><circle cx="18" cy="18" r="2" /></>);
export const IconShield = base(<><path d="M12 3 4 6v6c0 4.5 3.4 8.3 8 9 4.6-.7 8-4.5 8-9V6l-8-3z" /><path d="m9 12 2 2 4-4" /></>);
export const IconMore = base(<><circle cx="5" cy="12" r="1.3" /><circle cx="12" cy="12" r="1.3" /><circle cx="19" cy="12" r="1.3" /></>);
export const IconPin = base(<><path d="M9 4h6l-1 6 4 3v2H6v-2l4-3-1-6z" /><path d="M12 15v6" /></>);
export const IconZap = base(<path d="M13 2 4 14h7l-1 8 9-12h-7l1-8z" />);
export const IconArrowLeft = base(<><path d="M19 12H5M11 6l-6 6 6 6" /></>);
export const IconArrowRight = base(<><path d="M5 12h14M13 6l6 6-6 6" /></>);
export const IconRefresh = base(<><path d="M20 11a8 8 0 0 0-14.9-3M4 4v4h4M4 13a8 8 0 0 0 14.9 3M20 20v-4h-4" /></>);
export const IconLock = base(<><rect x="5" y="11" width="14" height="10" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>);
export const IconBook = base(<><path d="M4 5a2 2 0 0 1 2-2h13v16H6a2 2 0 0 0-2 2V5z" /><path d="M4 19a2 2 0 0 1 2-2h13" /></>);
export const IconStar = base(<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9L12 3z" />);
export const IconTrash2 = IconTrash;
export const IconSend = base(<><path d="M5 12h13" /><path d="m13 6 6 6-6 6" /></>);
/** Sprechblase mit Funkeln (KI-Assistent) */
export const IconChat = base(<><path d="M20.5 11.5a8 8 0 0 1-11.3 7.3L4 20l1.3-4.4A8 8 0 1 1 20.5 11.5z" /><path d="M12.5 7.5l.9 2.3 2.3.9-2.3.9-.9 2.3-.9-2.3-2.3-.9 2.3-.9z" fill="currentColor" strokeWidth={1.2} /></>);
export const IconStop = base(<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor" />);
export const IconUsers = base(<><circle cx="9" cy="8" r="3.5" /><path d="M2.5 20a6.5 6.5 0 0 1 13 0" /><path d="M16 4.6a3.5 3.5 0 0 1 0 6.8M18 14.2a6.5 6.5 0 0 1 3.5 5.8" /></>);
export const IconFace = base(<><path d="M4 8V5a1 1 0 0 1 1-1h3M16 4h3a1 1 0 0 1 1 1v3M20 16v3a1 1 0 0 1-1 1h-3M8 20H5a1 1 0 0 1-1-1v-3" /><circle cx="12" cy="11" r="3.2" /><path d="M7.5 18a5 5 0 0 1 9 0" /></>);
export const IconHistory = base(<><path d="M3 12a9 9 0 1 0 3-6.7L3 8" /><path d="M3 3v5h5" /><path d="M12 7v5l3 2" /></>);
export const IconPlusChat = base(<><path d="M20 12a8 8 0 0 1-11.8 7L4 20l1-4.2A8 8 0 1 1 20 12z" /><path d="M12 8.5v7M8.5 12h7" /></>);
export const IconDownload = base(<><path d="M12 4v11M7 10l5 5 5-5" /><path d="M5 20h14" /></>);
export const IconUpload = base(<><path d="M12 20V9M7 14l5-5 5 5" /><path d="M5 4h14" /></>);
export const IconBrain = base(<><path d="M9 4a3 3 0 0 0-3 3 3 3 0 0 0-2 5 3 3 0 0 0 2 5 3 3 0 0 0 3 3h0a2 2 0 0 0 3-1V5a2 2 0 0 0-3-1z" /><path d="M15 4a3 3 0 0 1 3 3 3 3 0 0 1 2 5 3 3 0 0 1-2 5 3 3 0 0 1-3 3h0a2 2 0 0 1-3-1" /></>);
export const IconTag = base(<><path d="M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9-9-9z" /><circle cx="7.5" cy="7.5" r="1.5" /></>);
export const IconActivity = base(<><path d="M4 6h10M4 12h7M4 18h10" /><path d="m15 13 2 2 4-4" /></>);
