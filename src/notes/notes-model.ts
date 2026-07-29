export type Note = {
  id: string;
  title: string;
  content: string;
  color: 'yellow' | 'blue' | 'green' | 'purple';
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
};
