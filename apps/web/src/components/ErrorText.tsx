import type { TestID } from "@pantry/core/testing";

export function ErrorText({ message, testId }: { message: string | null; testId?: TestID }) {
  return message ? (
    <p className="mt-2 text-sm text-danger" role="alert" data-testid={testId}>
      {message}
    </p>
  ) : null;
}
