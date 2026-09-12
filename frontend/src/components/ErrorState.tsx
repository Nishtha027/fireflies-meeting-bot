export function ErrorState({
  title = "Can't connect to the server",
  message,
  onRetry,
}: {
  title?: string;
  message: string;
  onRetry?: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 rounded-xl border border-red-200 bg-red-50 px-6 py-12 text-center">
      <div className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-red-600">
        !
      </div>
      <p className="text-base font-semibold text-red-800">{title}</p>
      <p className="max-w-md text-sm text-red-700">{message}</p>
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
        >
          Try again
        </button>
      )}
    </div>
  );
}
