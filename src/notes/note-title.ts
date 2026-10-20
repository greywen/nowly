import { contentToPlainText } from '../components/rich-text/content';
import { t } from '../i18n';

export function noteTitle(content: string): string {
  return contentToPlainText(content).split(/\r?\n/).map(line => line.trim()).find(Boolean) || t('notesWidget.untitled');
}
