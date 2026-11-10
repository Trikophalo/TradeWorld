import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations } from "next-intl/server";
import "@fontsource-variable/inter";
import "@fontsource/silkscreen/400.css";
import "@fontsource/silkscreen/700.css";
import "./globals.css";
import { Providers } from "@/components/providers";
import { APP_NAME, DEFAULT_LOCALE, SETTINGS_STORAGE_KEY } from "@/config/app";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("app");
  return {
    title: { default: `${APP_NAME} · ${t("tagline")}`, template: `%s · ${APP_NAME}` },
    description: t("description"),
    applicationName: APP_NAME,
    appleWebApp: { capable: true, title: APP_NAME, statusBarStyle: "black-translucent" },
    formatDetection: { telephone: false },
    icons: { apple: "/icons/apple-touch-icon.png" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#0a0c10" },
    { media: "(prefers-color-scheme: light)", color: "#f4f5f7" },
  ],
};

/**
 * Applies the saved theme, accent and motion setting before the first paint,
 * so there is no flash of the wrong theme. Mirrors applySettingsToDocument().
 */
const themeScript = `(function(){try{var s=JSON.parse(localStorage.getItem(${JSON.stringify(
  SETTINGS_STORAGE_KEY,
)})||"{}").state||{};var d=document.documentElement;d.dataset.theme=s.theme==="light"?"light":"dark";if(s.accent&&s.accent!=="violet")d.dataset.accent=s.accent;if(s.motion&&s.motion!=="system")d.dataset.motion=s.motion;}catch(e){}})();`;

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang={DEFAULT_LOCALE} data-theme="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body className="antialiased">
        <NextIntlClientProvider>
          <Providers>{children}</Providers>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
