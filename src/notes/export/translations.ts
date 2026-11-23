import type { Language } from '../../i18n/store';

const en = {
  open: 'Export notes', exit: 'Exit export', all: 'Select all notes', select: 'Select note: {title}',
  count: '{selected} / {total} selected', format: 'Export format', submit: 'Export selected notes',
  busy: 'Exporting…', progress: 'Preparing {done} / {total}', success: 'Exported successfully', cancelled: 'Save cancelled',
  failed: 'Export failed. Your notes are unchanged. Please try again.',
  attachment: 'An attachment could not be read. Restore the missing file and try again.',
  tooLarge: 'This export exceeds 256 MB. Select fewer notes and try again.',
  desktopOnly: 'PDF export requires the Nowly Windows desktop app. Markdown is available here.',
  empty: 'Select at least one note.',
  markdownHint: 'Markdown preserves content and basic formatting. Colors, font sizes and alignment are simplified.',
  pdfHint: 'PDF preserves readable text and local images. Videos and external images are exported as links.',
  bundleHint: 'Multiple notes or attachments are packaged as a ZIP. Each note has its own document and assets folder.',
  attachments: 'Included attachments', title: 'Export note', draftHint: 'Exports the current content without saving changes to the note.'
};
type Catalog = Record<keyof typeof en, string>;
const catalogs: Record<Language, Catalog> = {
  en,
  zh: {
    open:'导出便签',exit:'退出导出',all:'全选便签',select:'选择便签：{title}',count:'已选 {selected} / {total} 条',format:'导出格式',submit:'导出所选便签',
    busy:'正在导出…',progress:'正在准备 {done} / {total}',success:'已导出',cancelled:'已取消保存',failed:'导出失败，便签未被修改，请重试。',
    attachment:'无法读取附件，请恢复缺失文件后重试。',tooLarge:'本次导出超过 256 MB，请减少选择的便签数量。',desktopOnly:'PDF 导出需要 Nowly Windows 桌面版，此处可导出 Markdown。',empty:'请至少选择一条便签。',
    markdownHint:'Markdown 保留内容及基础格式，颜色、字号和对齐等样式会简化。',pdfHint:'PDF 保留可复制文字和本地图片；视频及外部图片以链接导出。',
    bundleHint:'批量或含附件时打包为 ZIP，每条便签拥有独立文档与附件目录。',attachments:'随包附件',title:'导出便签',draftHint:'导出当前内容，不会自动保存对便签的修改。'
  },
  'zh-Hant': {
    open:'匯出便箋',exit:'退出匯出',all:'全選便箋',select:'選擇便箋：{title}',count:'已選 {selected} / {total} 則',format:'匯出格式',submit:'匯出所選便箋',
    busy:'正在匯出…',progress:'正在準備 {done} / {total}',success:'已匯出',cancelled:'已取消儲存',failed:'匯出失敗，便箋未被修改，請重試。',
    attachment:'無法讀取附件，請還原遺失檔案後重試。',tooLarge:'本次匯出超過 256 MB，請減少選擇的便箋數量。',desktopOnly:'PDF 匯出需要 Nowly Windows 桌面版，此處可匯出 Markdown。',empty:'請至少選擇一則便箋。',
    markdownHint:'Markdown 保留內容及基本格式，色彩、字級與對齊等樣式會簡化。',pdfHint:'PDF 保留可複製文字與本機圖片；影片及外部圖片以連結匯出。',
    bundleHint:'多則便箋或含附件時封裝為 ZIP，每則便箋擁有獨立文件與附件目錄。',attachments:'隨附附件',title:'匯出便箋',draftHint:'匯出目前內容，不會自動儲存對便箋的修改。'
  },
  fr: {
    open:'Exporter les notes',exit:'Quitter l’export',all:'Sélectionner toutes les notes',select:'Sélectionner la note : {title}',count:'{selected} / {total} sélectionnées',format:'Format d’export',submit:'Exporter la sélection',
    busy:'Export en cours…',progress:'Préparation : {done} / {total}',success:'Export terminé',cancelled:'Enregistrement annulé',failed:'Échec de l’export. Les notes sont inchangées. Réessayez.',
    attachment:'Une pièce jointe est illisible. Restaurez le fichier manquant puis réessayez.',tooLarge:'L’export dépasse 256 Mo. Sélectionnez moins de notes.',desktopOnly:'L’export PDF nécessite Nowly pour Windows. Markdown reste disponible ici.',empty:'Sélectionnez au moins une note.',
    markdownHint:'Markdown conserve le contenu et la mise en forme de base. Couleurs, tailles et alignement sont simplifiés.',pdfHint:'Le PDF conserve le texte copiable et les images locales. Vidéos et images externes deviennent des liens.',
    bundleHint:'Plusieurs notes ou pièces jointes sont regroupées en ZIP, avec un document et un dossier de fichiers par note.',attachments:'Pièces jointes incluses',title:'Exporter la note',draftHint:'Exporte le contenu actuel sans enregistrer les modifications de la note.'
  },
  es: {
    open:'Exportar notas',exit:'Salir de la exportación',all:'Seleccionar todas las notas',select:'Seleccionar nota: {title}',count:'{selected} / {total} seleccionadas',format:'Formato de exportación',submit:'Exportar selección',
    busy:'Exportando…',progress:'Preparando {done} / {total}',success:'Exportación completada',cancelled:'Guardado cancelado',failed:'No se pudo exportar. Las notas no han cambiado. Inténtalo de nuevo.',
    attachment:'No se puede leer un adjunto. Restaura el archivo e inténtalo de nuevo.',tooLarge:'La exportación supera los 256 MB. Selecciona menos notas.',desktopOnly:'La exportación PDF requiere Nowly para Windows. Aquí puedes usar Markdown.',empty:'Selecciona al menos una nota.',
    markdownHint:'Markdown conserva el contenido y el formato básico. Se simplifican colores, tamaños y alineación.',pdfHint:'El PDF conserva texto copiable e imágenes locales. Los vídeos e imágenes externas se exportan como enlaces.',
    bundleHint:'Varias notas o adjuntos se agrupan en un ZIP, con un documento y una carpeta de archivos por nota.',attachments:'Adjuntos incluidos',title:'Exportar nota',draftHint:'Exporta el contenido actual sin guardar los cambios de la nota.'
  },
  ja: {
    open:'メモをエクスポート',exit:'エクスポートを終了',all:'すべてのメモを選択',select:'メモを選択：{title}',count:'{selected} / {total} 件選択',format:'出力形式',submit:'選択したメモを出力',
    busy:'出力中…',progress:'準備中 {done} / {total}',success:'出力しました',cancelled:'保存をキャンセルしました',failed:'出力に失敗しました。メモは変更されていません。再試行してください。',
    attachment:'添付ファイルを読み込めません。失われたファイルを復元して再試行してください。',tooLarge:'出力が 256 MB を超えています。選択するメモを減らしてください。',desktopOnly:'PDF 出力には Windows 版 Nowly が必要です。ここでは Markdown を利用できます。',empty:'メモを1件以上選択してください。',
    markdownHint:'Markdown は内容と基本書式を保持します。色、文字サイズ、配置は簡略化されます。',pdfHint:'PDF はコピー可能な文字とローカル画像を保持します。動画と外部画像はリンクになります。',
    bundleHint:'複数のメモや添付ファイルは ZIP にまとめられ、メモごとに文書と添付フォルダーが作成されます。',attachments:'同梱の添付ファイル',title:'メモの出力',draftHint:'現在の内容を出力します。メモへの変更は自動保存されません。'
  },
  ko: {
    open:'메모 내보내기',exit:'내보내기 종료',all:'모든 메모 선택',select:'메모 선택: {title}',count:'{selected} / {total}개 선택',format:'내보내기 형식',submit:'선택한 메모 내보내기',
    busy:'내보내는 중…',progress:'준비 중 {done} / {total}',success:'내보내기 완료',cancelled:'저장 취소됨',failed:'내보내지 못했습니다. 메모는 변경되지 않았습니다. 다시 시도하세요.',
    attachment:'첨부 파일을 읽을 수 없습니다. 누락된 파일을 복원한 후 다시 시도하세요.',tooLarge:'내보내기가 256 MB를 초과합니다. 메모를 더 적게 선택하세요.',desktopOnly:'PDF 내보내기는 Windows용 Nowly에서 지원됩니다. 여기서는 Markdown을 사용할 수 있습니다.',empty:'메모를 하나 이상 선택하세요.',
    markdownHint:'Markdown은 내용과 기본 서식을 유지합니다. 색상, 글자 크기, 정렬은 간소화됩니다.',pdfHint:'PDF는 복사 가능한 텍스트와 로컬 이미지를 유지합니다. 동영상과 외부 이미지는 링크로 내보냅니다.',
    bundleHint:'여러 메모 또는 첨부 파일은 ZIP으로 묶이며 메모별 문서와 첨부 폴더가 생성됩니다.',attachments:'포함된 첨부 파일',title:'메모 내보내기',draftHint:'현재 내용을 내보내며 메모 변경 사항을 자동으로 저장하지 않습니다.'
  }
};
export const noteExportTranslations = Object.fromEntries(Object.entries(catalogs).map(([language, entries]) => [
  language, Object.fromEntries(Object.entries(entries).map(([key, value]) => [`noteExport.${key}`, value]))
])) as Record<Language, Record<string, string>>;
