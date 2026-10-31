export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4 py-12 text-center">
      <h1 className="text-xl font-semibold">Shop not found</h1>
      <p className="mt-2 text-gray-600">
        This link doesn&apos;t match any shop. Please scan the QR code on the counter again.
      </p>
    </main>
  );
}
