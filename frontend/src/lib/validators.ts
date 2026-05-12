/** Input validators */

export const USERNAME_REGEX = /^[a-zA-Z0-9_.-]{3,64}$/;

export function isValidUsername(username: string): boolean {
  return USERNAME_REGEX.test(username);
}

export function isValidDisplayName(name: string): boolean {
  return name.trim().length >= 1 && name.trim().length <= 128;
}
