export type ReviewStatus = 'pending' | 'draft' | 'sent';

/** Another instructor who also worked with this student during the review month. */
export interface SharedInstructor {
  instructorId: number;
  name: string;
  dates: string[];
}

export interface ReviewDto {
  id: number;
  studentId: number;
  studentName: string;
  githubUsername: string | null;
  month: string;
  status: ReviewStatus;
  subject: string | null;
  body: string | null;
  sentAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Present on the single-review fetch; other instructors sharing this student this month. */
  sharedWith?: SharedInstructor[];
}
