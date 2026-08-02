export const noteColors = ['yellow', 'blue', 'green', 'purple'] as const;
export type NoteColor = (typeof noteColors)[number];

export type NoteDraft = {
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
};

export type Note = {
  id: string;
  title: string;
  content: string;
  color: NoteColor;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};
