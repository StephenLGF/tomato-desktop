import React, { useState } from 'react';
import type { CustomOpenAIProvider } from '@/context/SettingsContext';
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Input,
  Button,
  Textarea,
  Tooltip,
  TooltipTrigger,
  TooltipContent,
} from '@/components/ui';
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
  RefreshCw,
  Trash2,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';
import { normalizeManualModels } from '@/lib/ai-service/custom-providers';
import { probeCustomOpenAIProvider } from '@/lib/ai-service/custom-provider-probe';
import { MOARK_PROVIDER_ID } from '@/lib/services/settings-service';

export interface CustomProviderCardProps {
  provider: CustomOpenAIProvider;
  onChange: (id: string, patch: Partial<CustomOpenAIProvider>) => void;
  onRemove: (id: string) => void;
}

function modelsToText(models: string[] | undefined): string {
  return (models ?? []).join('\n');
}

function textToModels(text: string): string[] | undefined {
  const parts = text
    .split(/[\n,]/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return normalizeManualModels(parts);
}

function CustomProviderCardBase({
  provider,
  onChange,
  onRemove,
}: CustomProviderCardProps) {
  const [showApiKey, setShowApiKey] = useState(false);
  const [isProbing, setIsProbing] = useState(false);
  const [detectedModelCount, setDetectedModelCount] = useState<number | null>(
    null,
  );
  const { t } = useTranslation('common');
  const isMoark = provider.id === MOARK_PROVIDER_ID;

  const handleProbe = async () => {
    setIsProbing(true);
    setDetectedModelCount(null);
    try {
      const modelIds = await probeCustomOpenAIProvider(
        provider.baseUrl,
        provider.apiKey,
      );
      setDetectedModelCount(modelIds.length);
      toast.success(
        t('settings.customProviders.detectSuccess', {
          count: modelIds.length,
          defaultValue: 'Connected. Detected {{count}} models.',
        }),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      toast.error(
        t('settings.customProviders.detectFailed', {
          detail,
          defaultValue: 'Connection failed: {{detail}}',
        }),
      );
    } finally {
      setIsProbing(false);
    }
  };

  return (
    <Card className="bg-background border shadow-sm min-w-0 w-full">
      <CardHeader className="pb-4 flex flex-row items-start justify-between gap-2 space-y-0">
        <div className="min-w-0 flex-1 space-y-2">
          <CardTitle className="text-foreground text-base font-medium">
            {isMoark
              ? t('settings.customProviders.moarkTitle', 'Moark API')
              : t(
                  'settings.customProviders.cardTitle',
                  'Custom OpenAI Provider',
                )}
          </CardTitle>
          <Input
            type="text"
            placeholder={t(
              'settings.customProviders.namePlaceholder',
              'e.g., Local-LMStudio, vLLM-Server-1',
            )}
            value={provider.name}
            onChange={(e) => onChange(provider.id, { name: e.target.value })}
            className="bg-background border text-foreground w-full"
            aria-label={t('settings.customProviders.name', 'Display name')}
          />
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          onClick={() => onRemove(provider.id)}
          aria-label={t(
            'settings.customProviders.remove',
            'Remove custom provider',
          )}
        >
          <Trash2 className="h-4 w-4 text-destructive" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3 min-w-0">
        <div className="min-w-0">
          <label className="block text-muted-foreground mb-2 text-sm font-medium">
            {t('settings.provider.baseUrl', 'Base URL')}
          </label>
          <Input
            type="url"
            placeholder={t(
              'settings.customProviders.baseUrlPlaceholder',
              'http://192.168.1.100:8000/v1',
            )}
            value={provider.baseUrl}
            onChange={(e) => onChange(provider.id, { baseUrl: e.target.value })}
            className="bg-background border text-foreground w-full"
          />
        </div>

        <div className="min-w-0">
          <label className="block text-muted-foreground mb-2 text-sm font-medium">
            {isMoark
              ? t('settings.customProviders.accessToken', 'Access Token')
              : t('settings.provider.apiKey', 'API Key')}{' '}
            {!isMoark && (
              <span className="font-normal">
                ({t('settings.customProviders.optional', 'optional')})
              </span>
            )}
          </label>
          <div className="relative">
            <Input
              type={showApiKey ? 'text' : 'password'}
              placeholder={
                isMoark
                  ? t(
                      'settings.customProviders.moarkTokenPlaceholder',
                      'Enter Moark Token',
                    )
                  : t(
                      'settings.customProviders.apiKeyPlaceholder',
                      'Leave empty for local servers',
                    )
              }
              value={provider.apiKey || ''}
              onChange={(e) =>
                onChange(provider.id, { apiKey: e.target.value })
              }
              className="bg-background border text-foreground w-full pr-10"
            />
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                  onClick={() => setShowApiKey((v) => !v)}
                  aria-label={
                    showApiKey
                      ? t('settings.provider.hideApiKey', 'Hide API key')
                      : t('settings.provider.showApiKey', 'Show API key')
                  }
                  aria-pressed={showApiKey}
                >
                  {showApiKey ? (
                    <EyeOff className="h-4 w-4 text-muted-foreground" />
                  ) : (
                    <Eye className="h-4 w-4 text-muted-foreground" />
                  )}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {showApiKey
                  ? t('settings.provider.hideApiKey', 'Hide API key')
                  : t('settings.provider.showApiKey', 'Show API key')}
              </TooltipContent>
            </Tooltip>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void handleProbe()}
              disabled={isProbing || !provider.baseUrl.trim()}
              className="gap-1.5"
            >
              {isProbing ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
              {isProbing
                ? t('settings.customProviders.detecting', 'Detecting...')
                : t(
                    'settings.customProviders.detect',
                    'Test and detect models',
                  )}
            </Button>
            {detectedModelCount !== null ? (
              <span className="inline-flex items-center gap-1 text-xs text-success">
                <CheckCircle2 className="h-3.5 w-3.5" />
                {t('settings.customProviders.detectedModels', {
                  count: detectedModelCount,
                  defaultValue: '{{count}} models detected',
                })}
              </span>
            ) : null}
          </div>
        </div>

        <details className="min-w-0 rounded-md border border-border/60 p-3">
          <summary className="cursor-pointer text-sm font-medium text-muted-foreground">
            {t(
              'settings.customProviders.manualModelsSummary',
              'Endpoint cannot list models? Add model IDs manually',
            )}
          </summary>
          <Textarea
            aria-label={t('settings.customProviders.models', 'Models')}
            placeholder={t(
              'settings.customProviders.modelsPlaceholder',
              'One model ID per line or comma-separated',
            )}
            value={modelsToText(provider.models)}
            onChange={(e) =>
              onChange(provider.id, { models: textToModels(e.target.value) })
            }
            className="mt-3 min-h-[72px] w-full border bg-background text-foreground"
          />
          <p className="text-xs text-muted-foreground mt-1">
            {t(
              'settings.customProviders.modelsDescription',
              'Only use this fallback when the endpoint does not implement /v1/models.',
            )}
          </p>
        </details>
      </CardContent>
    </Card>
  );
}

export const CustomProviderCard = React.memo(
  CustomProviderCardBase,
  (prev, next) => {
    // Callbacks are intentionally omitted: parents recreate them when provider
    // list identity changes, and field equality already gates useful skips.
    return (
      prev.provider.id === next.provider.id &&
      prev.provider.name === next.provider.name &&
      prev.provider.baseUrl === next.provider.baseUrl &&
      (prev.provider.apiKey || '') === (next.provider.apiKey || '') &&
      modelsToText(prev.provider.models) === modelsToText(next.provider.models)
    );
  },
);
