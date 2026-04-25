import './globals.css';

export const metadata = {
  title: 'Solar Roof Planner',
  description: '3D solar panel planning on satellite-derived city models',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
