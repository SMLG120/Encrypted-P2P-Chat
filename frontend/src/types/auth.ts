// Auth types
export interface User {
  id: string;
  username: string;
  display_name: string;
  avatar_url?: string;
}

export interface AuthResponse {
  user: User;
  message: string;
}
