export function ErrorText({ message }: { message: string | null }) {
  return message ? (
    <p className="mt-2 text-sm text-danger" role="alert">
      {message}
    </p>
  ) : null;
}
