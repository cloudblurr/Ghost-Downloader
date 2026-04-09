export const metadata = {
  title: 'Ghost Downloader',
  description: 'Paste a link. Get the media. Any device.',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
