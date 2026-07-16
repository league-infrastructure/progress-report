export type ReviewStatus = 'pending' | 'draft' | 'sent';

/** Another instructor who also worked with this student during the review month. */
export interface SharedInstructor {
  instructorId: number;
  name: string;
  dates: string[];
  /** Status of that instructor's own review for this student this month. */
  reviewStatus: 'sent' | 'draft' | 'pending' | 'none';
  /** ISO timestamp they sent their review, if sent. */
  sentAt: string | null;
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
