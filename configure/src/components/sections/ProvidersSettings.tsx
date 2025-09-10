import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { useConfig } from '@/contexts/ConfigContext';
import { Switch } from '@/components/ui/switch';

const movieProviders = [
  { value: 'tmdb', label: 'The Movie Database (TMDB)' },
  { value: 'tvdb', label: 'TheTVDB' },
  { value: 'imdb', label: 'IMDb' },
];

const seriesProviders = [
  { value: 'tvdb', label: 'TheTVDB (Recommended)' },
  { value: 'tmdb', label: 'The Movie Database' },
  { value: 'tvmaze', label: 'TVmaze' },
  { value: 'imdb', label: 'IMDb' },
];

const animeProviders = [
  { value: 'mal', label: 'MyAnimeList (Recommended)' },
  { value: 'tvdb', label: 'TheTVDB' },
  // { value: 'tmdb', label: 'The Movie Database' },
  { value: 'imdb', label: 'IMDb' },
];

const animeIdProviders = [
  { value: 'imdb', label: 'IMDb (More compatibility)' },
  { value: 'kitsu', label: 'Kitsu ID (Recommended)' },
  { value: 'mal', label: 'MyAnimeList ID' },
];

const tvdbSeasonTypes = [
  { value: 'official', label: 'Official Order' },
  { value: 'default', label: 'Aired Order (Default)' },
  { value: 'dvd', label: 'DVD Order' },
  { value: 'absolute', label: 'Absolute Order' },
  { value: 'alternate', label: 'Alternate Order' },
  { value: 'regional', label: 'Regional Order' },
];


export function ProvidersSettings() {
  const { config, setConfig } = useConfig();

  const handleProviderChange = (type: 'movie' | 'series' | 'anime', value: string) => {
    setConfig(prev => ({ ...prev, providers: { ...prev.providers, [type]: value } }));
  };

  const handleSeasonTypeChange = (value: string) => {
    setConfig(prev => ({ ...prev, tvdbSeasonType: value }));
  };
 
  const handleMalToggle = (key: 'skipFiller' | 'skipRecap', checked: boolean) => {
    setConfig(prev => ({
      ...prev,
      mal: {
        ...prev.mal,
        [key]: checked,
      }
    }));
  };

  const handleAnimeIdProviderChange = (value: 'imdb' | 'kitsu' | 'mal') => {
    setConfig(prev => ({
        ...prev,
        providers: {
            ...prev.providers,
            anime_id_provider: value
        }
    }));
  };


  return (
    <div className="space-y-8 animate-fade-in">
      <div>
        <h2 className="text-2xl font-semibold">Metadata Providers</h2>
        <p className="text-muted-foreground mt-1">Choose your preferred source for metadata. Different providers may have better data for certain content.</p>
        <p className="text-xs text-amber-400 mt-4 p-3 bg-amber-900/20 border border-amber-400/30 rounded-lg">
          <strong>Smart Fallback:</strong> If metadata for a title can't be found with your preferred provider (e.g., no TVDB entry for a TMDB movie), the addon will automatically use the item's original source to guarantee you get a result.
        </p>
      </div>

      {/* Provider Selection Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        <Card>
          <CardHeader><CardTitle>Movie Provider</CardTitle><CardDescription>Source for movie data.</CardDescription></CardHeader>
          <CardContent>
            <Select value={config.providers.movie} onValueChange={(val) => handleProviderChange('movie', val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {movieProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Series Provider</CardTitle><CardDescription>Source for TV show data.</CardDescription></CardHeader>
          <CardContent>
            <Select value={config.providers.series} onValueChange={(val) => handleProviderChange('series', val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {seriesProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Anime Provider</CardTitle><CardDescription>Source for anime data.</CardDescription></CardHeader>
          <CardContent>
            <Select value={config.providers.anime} onValueChange={(val) => handleProviderChange('anime', val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {animeProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </CardContent>
        </Card>
      </div>


      {/* TVDB Specific Settings */}
      <Card>
        <CardHeader>
          <CardTitle>TheTVDB Settings</CardTitle>
          <CardDescription>Customize how episode data is fetched from TheTVDB.</CardDescription>
        </CardHeader>
        <CardContent className="max-w-md">
            <Label className="text-lg font-medium">Season Order</Label>
            <Select value={config.tvdbSeasonType} onValueChange={handleSeasonTypeChange}>
              <SelectTrigger className="mt-2"><SelectValue /></SelectTrigger>
              <SelectContent>
                {tvdbSeasonTypes.map(s => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">"Aired Order (Default)" or "Official order" are recommended.</p>
        </CardContent>
      </Card>
      {/* MyAnimeList Specific Settings */}
      <Card>
        <CardHeader>
          <CardTitle>MyAnimeList (MAL) Settings</CardTitle>
          <CardDescription>
            Customize how data is handled when MyAnimeList is the source.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Skip Filler Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="skip-filler" className="text-lg font-medium">Skip Filler Episodes</Label>
              <p className="text-sm text-muted-foreground">Automatically filter out episodes marked as filler.</p>
            </div>
            <Switch
              id="skip-filler"
              checked={config.mal.skipFiller}
              onCheckedChange={(val) => handleMalToggle('skipFiller', val)}
            />
          </div>
          {/* Skip Recap Toggle */}
          <div className="flex items-center justify-between">
            <div>
              <Label htmlFor="skip-recap" className="text-lg font-medium">Skip Recap Episodes</Label>
              <p className="text-sm text-muted-foreground">Automatically filter out episodes marked as recaps.</p>
            </div>
            <Switch
              id="skip-recap"
              checked={config.mal.skipRecap}
              onCheckedChange={(val) => handleMalToggle('skipRecap', val)}
            />
          </div>
          {/* Stream Compatibility ID Dropdown */}
          <div className="pt-6 border-t border-border">
            <Label className="text-lg font-medium">Anime Stream Compatibility ID</Label>
            <p className="text-sm text-muted-foreground mt-1 mb-2">
              Choose which ID format to use for anime. This affects which streaming addons will find results.
            </p>
            <Select 
              value={config.providers.anime_id_provider}
              onValueChange={handleAnimeIdProviderChange as (value: string) => void}
            >
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                {animeIdProviders.map(p => <SelectItem key={p.value} value={p.value}>{p.label}</SelectItem>)}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-2">
              "IMDb" can improve compatibility as it is supported by most streaming addons. Kitsu is recommended when using MAL as meta provider.
            </p>
            <p className="text-xs text-amber-600 mt-1">
              ⚠️ Using TVDB/IMDb as anime meta provider with Kitsu/MAL anime compatibility ID is considered experimental as they rely on community mappings and could contain inaccurate information.
            </p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
