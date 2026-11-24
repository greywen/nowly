import type { Language } from '../../i18n/store';

const en = {
  open: 'Export notes', exit: 'Exit export', all: 'Select all notes', select: 'Select note: {title}',
  count: '{selected} / {total} selected', submit: 'Export selected notes',
  busy: 'Exporting…', progress: 'Preparing {done} / {total}', success: 'Exported successfully', cancelled: 'Save cancelled',
  failed: 'Export failed. Your notes are unchanged. Please try again.',
  attachment: 'An attachment could not be read. Restore the missing file and try again.',
  tooLarge: 'This export exceeds 256 MB. Select fewer notes and try again.',
  empty: 'Select at least one note.',
  markdownHint: 'Markdown preserves content and basic formatting. Colors, font sizes and alignment are simplified.',
  bundleHint: 'Multiple notes or notes with attachments are exported as a ZIP. Extract the entire ZIP before opening a .md file, and keep its assets/ folder beside it so images display.',
  title: 'Export note', draftHint: 'Exports the current content without saving changes to the note.'
};
type Catalog = Record<keyof typeof en, string>;
const catalogs: Record<Language, Catalog> = {
  en,
  zh: {
    open:'导出便签',exit:'退出导出',all:'全选便签',select:'选择便签：{title}',count:'已选 {selected} / {total} 条',submit:'导出所选便签',
    busy:'正在导出…',progress:'正在准备 {done} / {total}',success:'已导出',cancelled:'已取消保存',failed:'导出失败，便签未被修改，请重试。',
    attachment:'无法读取附件，请恢复缺失文件后重试。',tooLarge:'本次导出超过 256 MB，请减少选择的便签数量。',empty:'请至少选择一条便签。',
    markdownHint:'Markdown 保留内容及基础格式，颜色、字号和对齐等样式会简化。',
    bundleHint:'多条便签或含附件时导出为 ZIP。请先完整解压 ZIP，再打开 .md 文件，并保留同目录的 assets/ 文件夹以显示图片。',title:'导出便签',draftHint:'导出当前内容，不会自动保存对便签的修改。'
  },
  'zh-Hant': {
    open:'匯出便箋',exit:'退出匯出',all:'全選便箋',select:'選擇便箋：{title}',count:'已選 {selected} / {total} 則',submit:'匯出所選便箋',
    busy:'正在匯出…',progress:'正在準備 {done} / {total}',success:'已匯出',cancelled:'已取消儲存',failed:'匯出失敗，便箋未被修改，請重試。',
    attachment:'無法讀取附件，請還原遺失檔案後重試。',tooLarge:'本次匯出超過 256 MB，請減少選擇的便箋數量。',empty:'請至少選擇一則便箋。',
    markdownHint:'Markdown 保留內容及基本格式，色彩、字級與對齊等樣式會簡化。',
    bundleHint:'多則便箋或含附件時會匯出為 ZIP。請先完整解壓縮 ZIP，再開啟 .md 檔案，並保留同目錄下的 assets/ 資料夾以顯示圖片。',title:'匯出便箋',draftHint:'匯出目前內容，不會自動儲存對便箋的修改。'
  },
  fr: {
    open:'Exporter les notes',exit:'Quitter l’export',all:'Sélectionner toutes les notes',select:'Sélectionner la note : {title}',count:'{selected} / {total} sélectionnées',submit:'Exporter la sélection',
    busy:'Export en cours…',progress:'Préparation : {done} / {total}',success:'Export terminé',cancelled:'Enregistrement annulé',failed:'Échec de l’export. Les notes sont inchangées. Réessayez.',
    attachment:'Une pièce jointe est illisible. Restaurez le fichier manquant puis réessayez.',tooLarge:'L’export dépasse 256 Mo. Sélectionnez moins de notes.',empty:'Sélectionnez au moins une note.',
    markdownHint:'Markdown conserve le contenu et la mise en forme de base. Couleurs, tailles et alignement sont simplifiés.',
    bundleHint:'Les exports de plusieurs notes ou de notes avec pièces jointes sont regroupés dans un ZIP. Extrayez tout le ZIP avant d’ouvrir un fichier .md et gardez le dossier assets/ à côté pour afficher les images.',title:'Exporter la note',draftHint:'Exporte le contenu actuel sans enregistrer les modifications de la note.'
  },
  es: {
    open:'Exportar notas',exit:'Salir de la exportación',all:'Seleccionar todas las notas',select:'Seleccionar nota: {title}',count:'{selected} / {total} seleccionadas',submit:'Exportar selección',
    busy:'Exportando…',progress:'Preparando {done} / {total}',success:'Exportación completada',cancelled:'Guardado cancelado',failed:'No se pudo exportar. Las notas no han cambiado. Inténtalo de nuevo.',
    attachment:'No se puede leer un adjunto. Restaura el archivo e inténtalo de nuevo.',tooLarge:'La exportación supera los 256 MB. Selecciona menos notas.',empty:'Selecciona al menos una nota.',
    markdownHint:'Markdown conserva el contenido y el formato básico. Se simplifican colores, tamaños y alineación.',
    bundleHint:'Las exportaciones de varias notas o de notas con adjuntos se empaquetan en un ZIP. Extrae todo el ZIP antes de abrir un archivo .md y conserva la carpeta assets/ junto a él para ver las imágenes.',title:'Exportar nota',draftHint:'Exporta el contenido actual sin guardar los cambios de la nota.'
  },
  ja: {
    open:'メモをエクスポート',exit:'エクスポートを終了',all:'すべてのメモを選択',select:'メモを選択：{title}',count:'{selected} / {total} 件選択',submit:'選択したメモを出力',
    busy:'出力中…',progress:'準備中 {done} / {total}',success:'出力しました',cancelled:'保存をキャンセルしました',failed:'出力に失敗しました。メモは変更されていません。再試行してください。',
    attachment:'添付ファイルを読み込めません。失われたファイルを復元して再試行してください。',tooLarge:'出力が 256 MB を超えています。選択するメモを減らしてください。',empty:'メモを1件以上選択してください。',
    markdownHint:'Markdown は内容と基本書式を保持します。色、文字サイズ、配置は簡略化されます。',
    bundleHint:'複数のメモや添付ファイル付きのメモは ZIP になります。ZIP 全体を展開してから .md ファイルを開き、画像を表示するために assets/ フォルダーを同じ場所に残してください。',title:'メモの出力',draftHint:'現在の内容を出力します。メモへの変更は自動保存されません。'
  },
  ko: {
    open:'메모 내보내기',exit:'내보내기 종료',all:'모든 메모 선택',select:'메모 선택: {title}',count:'{selected} / {total}개 선택',submit:'선택한 메모 내보내기',
    busy:'내보내는 중…',progress:'준비 중 {done} / {total}',success:'내보내기 완료',cancelled:'저장 취소됨',failed:'내보내지 못했습니다. 메모는 변경되지 않았습니다. 다시 시도하세요.',
    attachment:'첨부 파일을 읽을 수 없습니다. 누락된 파일을 복원한 후 다시 시도하세요.',tooLarge:'내보내기가 256 MB를 초과합니다. 메모를 더 적게 선택하세요.',empty:'메모를 하나 이상 선택하세요.',
    markdownHint:'Markdown은 내용과 기본 서식을 유지합니다. 색상, 글자 크기, 정렬은 간소화됩니다.',
    bundleHint:'여러 메모나 첨부 파일이 있는 메모는 ZIP으로 내보냅니다. ZIP 전체의 압축을 푼 뒤 .md 파일을 열고, 이미지가 표시되도록 같은 위치에 assets/ 폴더를 유지하세요.',title:'메모 내보내기',draftHint:'현재 내용을 내보내며 메모 변경 사항을 자동으로 저장하지 않습니다.'
  }
};
export const noteExportTranslations = Object.fromEntries(Object.entries(catalogs).map(([language, entries]) => [
  language, Object.fromEntries(Object.entries(entries).map(([key, value]) => [`noteExport.${key}`, value]))
])) as Record<Language, Record<string, string>>;
