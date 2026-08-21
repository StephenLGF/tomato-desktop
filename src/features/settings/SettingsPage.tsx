import type { FC } from 'react';
import { BrainCircuit, Loader2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  Badge,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from '@/components/ui';
import GeneralTab from './tabs/GeneralTab';
import AIModelsTab from './tabs/AIModelsTab';
import ChatInterfaceTab from './tabs/ChatInterfaceTab';
import SystemTab from './tabs/SystemTab';
import AdvancedTab from './tabs/AdvancedTab';
import DevTab from './tabs/DevTab';
import ExperimentalTab from './tabs/ExperimentalTab';
import {
  PROVIDER_ENTRIES,
  useSettingsPageController,
} from './hooks/useSettingsPageController';

const SettingsPage: FC = function SettingsPage() {
  const { t } = useTranslation('common');
  const {
    formState,
    update,
    updateDisplay,
    updateAdvanced,
    activeTab,
    changedSectionCount,
    dangerZoneProps,
    handleContextStrategyChange,
    handleCustomProvidersChange,
    handleFallbackModelChange,
    handleLanguageChange,
    handleMaxInputContextChange,
    handlePendingChange,
    handlePreferredModelChange,
    handleTabChange,
    handleToolCallGroupVisibleCountChange,
    handleWindowSizeChange,
    isDirty,
    isSaving,
    networkSettingsChanged,
    systemSettingsProps,
    tabNavigationItems,
    updateExperimental,
  } = useSettingsPageController();

  return (
    <div className="p-6 h-full flex flex-col bg-background">
      <div className="max-w-4xl mx-auto w-full flex flex-col h-full">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <div className="flex items-center gap-4">
            <div className="flex items-center justify-center p-2.5 bg-primary/10 text-primary rounded-xl">
              <BrainCircuit size={28} />
            </div>
            <div>
              <h1 className="text-2xl text-foreground font-semibold tracking-tight">
                {t('settings.title', 'Settings')}
              </h1>
              <p className="text-sm text-muted-foreground mt-0.5">
                {t('settings.versionLabel', {
                  defaultValue: '{{appName}} v{{version}}',
                  appName: t('appName', 'Moark Desktop'),
                  version: __APP_VERSION__,
                })}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap justify-end">
            {(isDirty || isSaving) && (
              <Badge
                variant="outline"
                className="border-primary/30 bg-primary/10 text-foreground"
              >
                {isSaving && (
                  <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                )}
                {isSaving
                  ? t('settings.saving', 'Saving...')
                  : t('settings.pendingAutoSave', {
                      count: changedSectionCount,
                      defaultValue: 'Applying {{count}} changes...',
                    })}
              </Badge>
            )}
            {networkSettingsChanged && (
              <Badge
                variant="outline"
                className="border-warning/30 bg-warning/10 text-warning-foreground"
              >
                {t(
                  'settings.system.restartRequired',
                  'Restart required for network settings',
                )}
              </Badge>
            )}
          </div>
        </div>

        {/* Content */}
        <div className="flex-1 min-h-0 overflow-y-auto pr-2 pb-4">
          <Tabs
            value={activeTab}
            onValueChange={handleTabChange}
            className="flex flex-col min-h-full"
          >
            <TabsList className="sticky top-0 z-10 mb-4 flex gap-2 overflow-x-auto border border-border/60 bg-background/95 p-1 backdrop-blur supports-[backdrop-filter]:bg-background/80">
              {tabNavigationItems.map((tab) => (
                <TabsTrigger
                  key={tab.value}
                  value={tab.value}
                  className={`gap-2 ${tab.className ?? ''}`.trim()}
                >
                  {tab.label}
                  {tab.isDirty && (
                    <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  )}
                </TabsTrigger>
              ))}
            </TabsList>

            <TabsContent value="general">
              <GeneralTab
                localLanguage={formState.uiLanguage}
                onChange={handleLanguageChange}
                localDisplay={formState.display}
                onDisplaySettingsChange={updateDisplay}
              />
            </TabsContent>

            <TabsContent value="ai-models">
              <AIModelsTab
                serviceConfigs={formState.serviceConfigs}
                customProviders={formState.customProviders ?? []}
                providerEntries={PROVIDER_ENTRIES}
                localPreferredModel={formState.preferredModel}
                localFallbackModel={formState.fallbackModel}
                temperatureOverrideEnabled={
                  formState.temperatureOverrideEnabled
                }
                temperature={formState.temperature}
                onPendingChange={handlePendingChange}
                onCustomProvidersChange={handleCustomProvidersChange}
                onPreferredModelChange={handlePreferredModelChange}
                onFallbackModelChange={handleFallbackModelChange}
                onTemperatureOverrideEnabledChange={(enabled) =>
                  update('temperatureOverrideEnabled', enabled)
                }
                onTemperatureChange={(temperature) =>
                  update('temperature', temperature)
                }
              />
            </TabsContent>

            <TabsContent value="chat-interface">
              <ChatInterfaceTab
                localContextStrategy={formState.contextStrategy}
                localWindowSize={formState.windowSize}
                localMaxInputContext={formState.maxInputContext}
                localToolCallGroupVisibleCount={
                  formState.toolCallGroupVisibleCount
                }
                localAdvancedSettings={formState.advanced}
                onContextStrategyChange={handleContextStrategyChange}
                onWindowSizeChange={handleWindowSizeChange}
                onMaxInputContextChange={handleMaxInputContextChange}
                onToolCallGroupVisibleCountChange={
                  handleToolCallGroupVisibleCountChange
                }
                onAdvancedSettingsChange={updateAdvanced}
              />
            </TabsContent>

            <TabsContent value="system">
              <SystemTab systemSettingsProps={systemSettingsProps} />
            </TabsContent>

            <TabsContent value="advanced">
              <AdvancedTab
                localAdvancedSettings={formState.advanced}
                onChange={updateAdvanced}
                systemSettingsProps={systemSettingsProps}
                dangerZoneProps={dangerZoneProps}
              />
            </TabsContent>

            <TabsContent value="experimental">
              <ExperimentalTab
                localExperimentalSettings={formState.experimental}
                onChange={updateExperimental}
              />
            </TabsContent>

            {import.meta.env.DEV && (
              <TabsContent value="dev">
                <DevTab serviceConfigs={formState.serviceConfigs} />
              </TabsContent>
            )}
          </Tabs>
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
