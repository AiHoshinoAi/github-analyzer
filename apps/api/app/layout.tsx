import type { ReactNode } from "react";

export const metadata = {
  title: "GitHub Analyzer API",
  description: "Backend API for the GitHub repository analysis platform."
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
