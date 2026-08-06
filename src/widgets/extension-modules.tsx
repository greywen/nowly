import type { ExtensionModuleComponent } from './extension-module';
import { FocusTimerWidget } from './FocusTimerWidget';
import { NewsWordCloudWidget } from './NewsWordCloudWidget';
import { VocabularyWidget } from './VocabularyWidget';
import type { WidgetId } from './widget-registry';

// Binds each extension id to the component that runs it. Placement metadata
// stays in the widget registry (extensionDefinitions); this is only the
// component side of the contract, so adding a module means: write the component,
// add its definition, and register it here.
export const extensionComponents: Record<string, ExtensionModuleComponent> = {
  focusTimer: FocusTimerWidget,
  newsWordCloud: NewsWordCloudWidget,
  vocabulary: VocabularyWidget
};

export function getExtensionComponent(id: WidgetId): ExtensionModuleComponent | undefined {
  return extensionComponents[id];
}
