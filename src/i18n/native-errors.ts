import type { Language } from './store';

// Safe fallback guidance for structured native errors with no exact authored
// translation. Diagnostic text remains on the localized error object.
export const nativeErrorTranslations: Record<Language, Record<string, string>> = {
  zh: {
    'nativeError.conflict': '数据已在其他位置更改，请重新加载后重试。',
    'nativeError.not_found': '此项目已不存在，请重新加载后重试。',
    'nativeError.validation_error': '请检查标出的字段后重试。',
    'nativeError.database_error': '无法读取本地数据，请重试。',
    'nativeError.system_error': '系统操作失败，请重试。',
    'nativeError.screenshotSaveFailed': '无法保存截图，选区和标注已保留，请重试。',
  },
  en: {
    'nativeError.conflict': 'This data changed elsewhere. Reload and try again.',
    'nativeError.not_found': 'This item is no longer available. Reload and try again.',
    'nativeError.validation_error': 'Check the highlighted field and try again.',
    'nativeError.database_error': 'Unable to read local data. Please try again.',
    'nativeError.system_error': 'The system operation failed. Please try again.',
    'nativeError.screenshotSaveFailed': 'Unable to save the screenshot. Your selection and annotations are preserved. Please try again.',
  },
  fr: {
    'nativeError.conflict': 'Ces données ont été modifiées ailleurs. Rechargez-les, puis réessayez.',
    'nativeError.not_found': 'Cet élément n’est plus disponible. Rechargez les données, puis réessayez.',
    'nativeError.validation_error': 'Vérifiez le champ indiqué, puis réessayez.',
    'nativeError.database_error': 'Impossible de lire les données locales. Réessayez.',
    'nativeError.system_error': 'L’opération système a échoué. Réessayez.',
    'nativeError.screenshotSaveFailed': 'Impossible d’enregistrer la capture. La sélection et les annotations sont conservées. Réessayez.',
  },
  es: {
    'nativeError.conflict': 'Estos datos se modificaron en otro lugar. Vuelve a cargarlos e inténtalo de nuevo.',
    'nativeError.not_found': 'Este elemento ya no está disponible. Vuelve a cargar los datos e inténtalo de nuevo.',
    'nativeError.validation_error': 'Revisa el campo indicado e inténtalo de nuevo.',
    'nativeError.database_error': 'No se pudieron leer los datos locales. Inténtalo de nuevo.',
    'nativeError.system_error': 'La operación del sistema falló. Inténtalo de nuevo.',
    'nativeError.screenshotSaveFailed': 'No se pudo guardar la captura. La selección y las anotaciones se conservan. Inténtalo de nuevo.',
  },
  ar: {
    'nativeError.conflict': 'تم تعديل هذه البيانات في مكان آخر. أعد تحميلها ثم حاول مرة أخرى.',
    'nativeError.not_found': 'لم يعد هذا العنصر متاحًا. أعد تحميل البيانات ثم حاول مرة أخرى.',
    'nativeError.validation_error': 'تحقق من الحقل المحدد ثم حاول مرة أخرى.',
    'nativeError.database_error': 'تعذرت قراءة البيانات المحلية. حاول مرة أخرى.',
    'nativeError.system_error': 'فشلت عملية النظام. حاول مرة أخرى.',
    'nativeError.screenshotSaveFailed': 'تعذر حفظ لقطة الشاشة. تم الاحتفاظ بالتحديد والتعليقات التوضيحية. حاول مرة أخرى.',
  },
  ja: {
    'nativeError.conflict': 'このデータは別の場所で変更されました。再読み込みして、もう一度お試しください。',
    'nativeError.not_found': 'この項目は利用できなくなりました。再読み込みして、もう一度お試しください。',
    'nativeError.validation_error': '示された項目を確認して、もう一度お試しください。',
    'nativeError.database_error': 'ローカルデータを読み込めませんでした。もう一度お試しください。',
    'nativeError.system_error': 'システム操作に失敗しました。もう一度お試しください。',
    'nativeError.screenshotSaveFailed': 'スクリーンショットを保存できませんでした。選択範囲と注釈は保持されています。もう一度お試しください。',
  },
  ko: {
    'nativeError.conflict': '다른 곳에서 데이터가 변경되었습니다. 새로고침한 후 다시 시도하세요.',
    'nativeError.not_found': '이 항목은 더 이상 사용할 수 없습니다. 새로고침한 후 다시 시도하세요.',
    'nativeError.validation_error': '표시된 필드를 확인한 후 다시 시도하세요.',
    'nativeError.database_error': '로컬 데이터를 읽을 수 없습니다. 다시 시도하세요.',
    'nativeError.system_error': '시스템 작업에 실패했습니다. 다시 시도하세요.',
    'nativeError.screenshotSaveFailed': '스크린샷을 저장할 수 없습니다. 선택 영역과 주석은 유지됩니다. 다시 시도하세요.',
  },
  'zh-Hant': {
    'nativeError.conflict': '資料已在其他位置變更，請重新載入後再試。',
    'nativeError.not_found': '此項目已不存在，請重新載入後再試。',
    'nativeError.validation_error': '請檢查標示的欄位後再試。',
    'nativeError.database_error': '無法讀取本機資料，請再試一次。',
    'nativeError.system_error': '系統操作失敗，請再試一次。',
    'nativeError.screenshotSaveFailed': '無法儲存截圖，選取範圍與標註已保留，請再試一次。',
  },
};
