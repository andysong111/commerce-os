export const ACCOUNT_PASSWORD_MIN_LENGTH = 16;

export type AccountPasswordValidation =
  | { ok: true }
  | { ok: false; message: string };

export function validateAccountPassword(
  password: string,
  confirmation: string,
): AccountPasswordValidation {
  if (Array.from(password).length < ACCOUNT_PASSWORD_MIN_LENGTH) {
    return {
      ok: false,
      message: `비밀번호는 ${ACCOUNT_PASSWORD_MIN_LENGTH}자 이상이어야 합니다.`,
    };
  }

  if (password !== confirmation) {
    return {
      ok: false,
      message: "새 비밀번호와 비밀번호 확인이 일치하지 않습니다.",
    };
  }

  return { ok: true };
}
