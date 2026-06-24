import 'express-session';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  isAdmin: boolean;
  isActiveInstructor: boolean;
  instructorId?: number;
}

export interface QuizSessionUser {
  role: 'student' | 'instructor' | 'admin';
  studentId?: number;
  instructorId?: number;
  githubLogin?: string;
}

declare module 'express-session' {
  interface SessionData {
    user?: SessionUser;
    quizUser?: QuizSessionUser;
  }
}
