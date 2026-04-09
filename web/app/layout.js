import './globals.css';

export const metadata = {
  title: 'Ghost Downloader',
  description: 'Paste a link. Get the media. Any device.',
};

export const viewport = {
  themeColor: '#09090b',
  width: 'device-width',
  initialScale: 1,
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
