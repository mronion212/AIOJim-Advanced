import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { useConfig } from '@/contexts/ConfigContext';

// Define the options for the language select dropdown for clarity
const languageOptions = [
  { value: "ab-AB", label: "Abkhazian" },
  { value: "aa-AA", label: "Afar" },
  { value: "af-AF", label: "Afrikaans" },
  { value: "ak-AK", label: "Akan" },
  { value: "sq-AL", label: "Albanian" },
  { value: "am-AM", label: "Amharic" },
  { value: "ar-SA", label: "Arabic (Saudi Arabia)" },
  { value: "ar-AE", label: "Arabic (UAE)" },
  { value: "an-AN", label: "Aragonese" },
  { value: "hy-HY", label: "Armenian" },
  { value: "as-AS", label: "Assamese" },
  { value: "av-AV", label: "Avaric" },
  { value: "ae-AE", label: "Avestan" },
  { value: "ay-AY", label: "Aymara" },
  { value: "az-AZ", label: "Azerbaijani" },
  { value: "bm-BM", label: "Bambara" },
  { value: "ba-BA", label: "Bashkir" },
  { value: "eu-ES", label: "Basque" },
  { value: "be-BY", label: "Belarusian" },
  { value: "bn-BD", label: "Bengali" },
  { value: "bi-BI", label: "Bislama" },
  { value: "nb-NO", label: "Bokmål" },
  { value: "bs-BS", label: "Bosnian" },
  { value: "br-BR", label: "Breton" },
  { value: "bg-BG", label: "Bulgarian" },
  { value: "my-MY", label: "Burmese" },
  { value: "cn-CN", label: "Cantonese" },
  { value: "ca-ES", label: "Catalan" },
  { value: "km-KM", label: "Central Khmer" },
  { value: "ch-GU", label: "Chamorro" },
  { value: "ce-CE", label: "Chechen" },
  { value: "ny-NY", label: "Chichewa" },
  { value: "zh-CN", label: "Chinese (China)" },
  { value: "zh-HK", label: "Chinese (Hong Kong)" },
  { value: "zh-TW", label: "Chinese (Taiwan)" },
  { value: "cu-CU", label: "Church Slavic" },
  { value: "cv-CV", label: "Chuvash" },
  { value: "kw-KW", label: "Cornish" },
  { value: "co-CO", label: "Corsican" },
  { value: "cr-CR", label: "Cree" },
  { value: "hr-HR", label: "Croatian" },
  { value: "cs-CZ", label: "Czech" },
  { value: "da-DK", label: "Danish" },
  { value: "dv-DV", label: "Divehi" },
  { value: "nl-NL", label: "Dutch" },
  { value: "dz-DZ", label: "Dzongkha" },
  { value: "en-US", label: "English (US)" },
  { value: "en-AU", label: "English (Australia)" },
  { value: "en-CA", label: "English (Canada)" },
  { value: "en-GB", label: "English (UK)" },
  { value: "en-IE", label: "English (Ireland)" },
  { value: "en-NZ", label: "English (New Zealand)" },
  { value: "eo-EO", label: "Esperanto" },
  { value: "et-EE", label: "Estonian" },
  { value: "ee-EE", label: "Ewe" },
  { value: "fo-FO", label: "Faroese" },
  { value: "fj-FJ", label: "Fijian" },
  { value: "fi-FI", label: "Finnish" },
  { value: "fr-FR", label: "French (France)" },
  { value: "fr-CA", label: "French (Canada)" },
  { value: "ff-FF", label: "Fulah" },
  { value: "gd-GD", label: "Gaelic" },
  { value: "gl-ES", label: "Galician" },
  { value: "lg-LG", label: "Ganda" },
  { value: "ka-GE", label: "Georgian" },
  { value: "de-DE", label: "German (Germany)" },
  { value: "de-AT", label: "German (Austria)" },
  { value: "de-CH", label: "German (Switzerland)" },
  { value: "el-GR", label: "Greek" },
  { value: "gn-GN", label: "Guarani" },
  { value: "gu-GU", label: "Gujarati" },
  { value: "ht-HT", label: "Haitian" },
  { value: "ha-HA", label: "Hausa" },
  { value: "he-IL", label: "Hebrew" },
  { value: "hz-HZ", label: "Herero" },
  { value: "hi-IN", label: "Hindi" },
  { value: "ho-HO", label: "Hiri Motu" },
  { value: "hu-HU", label: "Hungarian" },
  { value: "is-IS", label: "Icelandic" },
  { value: "io-IO", label: "Ido" },
  { value: "ig-IG", label: "Igbo" },
  { value: "id-ID", label: "Indonesian" },
  { value: "ia-IA", label: "Interlingua" },
  { value: "ie-IE", label: "Interlingue" },
  { value: "iu-IU", label: "Inuktitut" },
  { value: "ik-IK", label: "Inupiaq" },
  { value: "ga-GA", label: "Irish" },
  { value: "it-IT", label: "Italian" },
  { value: "ja-JP", label: "Japanese" },
  { value: "jv-JV", label: "Javanese" },
  { value: "kl-KL", label: "Kalaallisut" },
  { value: "kn-IN", label: "Kannada" },
  { value: "kr-KR", label: "Kanuri" },
  { value: "ks-KS", label: "Kashmiri" },
  { value: "kk-KZ", label: "Kazakh" },
  { value: "ki-KI", label: "Kikuyu" },
  { value: "rw-RW", label: "Kinyarwanda" },
  { value: "ky-KY", label: "Kirghiz" },
  { value: "kv-KV", label: "Komi" },
  { value: "kg-KG", label: "Kongo" },
  { value: "ko-KR", label: "Korean" },
  { value: "kj-KJ", label: "Kuanyama" },
  { value: "ku-KU", label: "Kurdish" },
  { value: "lo-LO", label: "Lao" },
  { value: "la-LA", label: "Latin" },
  { value: "lv-LV", label: "Latvian" },
  { value: "li-LI", label: "Limburgan" },
  { value: "ln-LN", label: "Lingala" },
  { value: "lt-LT", label: "Lithuanian" },
  { value: "lu-LU", label: "Luba-Katanga" },
  { value: "lb-LB", label: "Luxembourgish" },
  { value: "mk-MK", label: "Macedonian" },
  { value: "mg-MG", label: "Malagasy" },
  { value: "ms-MY", label: "Malay (Malaysia)" },
  { value: "ms-SG", label: "Malay (Singapore)" },
  { value: "ml-IN", label: "Malayalam" },
  { value: "mt-MT", label: "Maltese" },
  { value: "gv-GV", label: "Manx" },
  { value: "mi-MI", label: "Maori" },
  { value: "mr-MR", label: "Marathi" },
  { value: "mh-MH", label: "Marshallese" },
  { value: "mo-MO", label: "Moldavian" },
  { value: "mn-MN", label: "Mongolian" },
  { value: "na-NA", label: "Nauru" },
  { value: "nv-NV", label: "Navajo" },
  { value: "nd-ND", label: "North Ndebele" },
  { value: "nr-NR", label: "South Ndebele" },
  { value: "ng-NG", label: "Ndonga" },
  { value: "ne-NE", label: "Nepali" },
  { value: "se-SE", label: "Northern Sami" },
  { value: "no-NO", label: "Norwegian" },
  { value: "nn-NN", label: "Norwegian Nynorsk" },
  { value: "oc-OC", label: "Occitan" },
  { value: "oj-OJ", label: "Ojibwa" },
  { value: "or-OR", label: "Oriya" },
  { value: "om-OM", label: "Oromo" },
  { value: "os-OS", label: "Ossetian" },
  { value: "pi-PI", label: "Pali" },
  { value: "pa-PA", label: "Panjabi" },
  { value: "fa-IR", label: "Persian" },
  { value: "pl-PL", label: "Polish" },
  { value: "pt-PT", label: "Portuguese (Portugal)" },
  { value: "pt-BR", label: "Portuguese (Brazil)" },
  { value: "ps-PS", label: "Pushto" },
  { value: "qu-QU", label: "Quechua" },
  { value: "ro-RO", label: "Romanian" },
  { value: "rm-RM", label: "Romansh" },
  { value: "rn-RN", label: "Rundi" },
  { value: "ru-RU", label: "Russian" },
  { value: "sm-SM", label: "Samoan" },
  { value: "sg-SG", label: "Sango" },
  { value: "sa-SA", label: "Sanskrit" },
  { value: "sc-SC", label: "Sardinian" },
  { value: "sr-RS", label: "Serbian" },
  { value: "sh-SH", label: "Serbo-Croatian" },
  { value: "sn-SN", label: "Shona" },
  { value: "ii-II", label: "Sichuan Yi" },
  { value: "sd-SD", label: "Sindhi" },
  { value: "si-LK", label: "Sinhala" },
  { value: "sk-SK", label: "Slovak" },
  { value: "sl-SI", label: "Slovenian" },
  { value: "so-SO", label: "Somali" },
  { value: "st-ST", label: "Sotho" },
  { value: "es-ES", label: "Spanish (Spain)" },
  { value: "es-MX", label: "Spanish (Mexico)" },
  { value: "su-SU", label: "Sundanese" },
  { value: "sw-SW", label: "Swahili" },
  { value: "ss-SS", label: "Swati" },
  { value: "sv-SE", label: "Swedish" },
  { value: "tl-PH", label: "Tagalog" },
  { value: "ty-TY", label: "Tahitian" },
  { value: "tg-TG", label: "Tajik" },
  { value: "ta-IN", label: "Tamil" },
  { value: "tt-TT", label: "Tatar" },
  { value: "te-IN", label: "Telugu" },
  { value: "th-TH", label: "Thai" },
  { value: "bo-BO", label: "Tibetan" },
  { value: "ti-TI", label: "Tigrinya" },
  { value: "to-TO", label: "Tonga" },
  { value: "ts-TS", label: "Tsonga" },
  { value: "tn-TN", label: "Tswana" },
  { value: "tr-TR", label: "Turkish" },
  { value: "tk-TK", label: "Turkmen" },
  { value: "tw-TW", label: "Twi" },
  { value: "ug-UG", label: "Uighur" },
  { value: "uk-UA", label: "Ukrainian" },
  { value: "ur-UR", label: "Urdu" },
  { value: "uz-UZ", label: "Uzbek" },
  { value: "ve-VE", label: "Venda" },
  { value: "vi-VN", label: "Vietnamese" },
  { value: "vo-VO", label: "Volapük" },
  { value: "wa-WA", label: "Walloon" },
  { value: "cy-CY", label: "Welsh" },
  { value: "fy-FY", label: "Western Frisian" },
  { value: "wo-WO", label: "Wolof" },
  { value: "xh-XH", label: "Xhosa" },
  { value: "yi-YI", label: "Yiddish" },
  { value: "yo-YO", label: "Yoruba" },
  { value: "za-ZA", label: "Zhuang" },
  { value: "zu-ZA", label: "Zulu" }
];

const castCountOptions = [
    { value: 5, label: '5 Members' },
    { value: 10, label: '10 Members' },
    { value: 15, label: '15 Members' },
    { value: 0, label: 'Unlimited' } 
];

export function GeneralSettings() {
  // Use our custom hook to get the current config and the function to update it
  const { config, setConfig } = useConfig();

  // --- Handler Functions ---
  // These functions update the single state object, preserving the other values.

  const handleLanguageChange = (value: string) => {
    setConfig(prevConfig => ({ ...prevConfig, language: value }));
  };

  const handleIncludeAdultChange = (checked: boolean) => {
    setConfig(prevConfig => ({ ...prevConfig, includeAdult: checked }));
  };

  const handleBlurThumbsChange = (checked: boolean) => {
    setConfig(prevConfig => ({ ...prevConfig, blurThumbs: checked }));
  };

  const handleShowPrefixChange = (checked: boolean) => {
    setConfig(prevConfig => ({ ...prevConfig, showPrefix: checked }));
  };

  const handleShowMetaProviderAttributionChange = (checked: boolean) => {
    setConfig(prevConfig => ({ ...prevConfig, showMetaProviderAttribution: checked }));
  };

  const handleCastCountChange = (value: string) => {
    const count = parseInt(value, 10);
    setConfig(prevConfig => ({ ...prevConfig, castCount: count }));
  };

  return (
    <div className="space-y-8 animate-fade-in">
      {/* Page Header */}
      <div>
        <h2 className="text-2xl font-semibold">General</h2>
        {/* FIX: Use theme-aware text-muted-foreground */}
        <p className="text-muted-foreground mt-1">Configure the basic display and content settings for your addon.</p>
      </div>

      {/* Settings Group */}
      <div>

        {/* Language Setting */}
        {/* FIX: Use theme-aware background/border on hover */}
        <div className="flex items-center justify-between p-4 rounded-lg border border-transparent hover:border-border hover:bg-accent transition-colors">
          <div>
            <Label htmlFor="language" className="text-lg font-medium">Display Language</Label>
            {/* FIX: Use theme-aware text color */}
            <p className="text-sm text-muted-foreground">Select the language for titles and descriptions.</p>
          </div>
          <Select value={config.language} onValueChange={handleLanguageChange}>
            {/* FIX: Remove all hard-coded colors. Let shadcn handle it. */}
            <SelectTrigger id="language" className="w-[200px]">
              <SelectValue placeholder="Select language" />
            </SelectTrigger>
            <SelectContent>
              {languageOptions.map(opt => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        {/* Include Adult Setting */}
        <div className="flex items-center justify-between p-4 rounded-lg border border-transparent hover:border-border hover:bg-accent transition-colors">
          <div>
            <Label htmlFor="adult-content" className="text-lg font-medium">Include Adult Content</Label>
            <p className="text-sm text-muted-foreground">Show 18+ content in catalogs and search.</p>
          </div>
          <Switch
            id="adult-content"
            checked={config.includeAdult}
            onCheckedChange={handleIncludeAdultChange}
          />
        </div>

        {/* Blur Thumbnails Setting */}
        <div className="flex items-center justify-between p-4 rounded-lg border border-transparent hover:border-border hover:bg-accent transition-colors">
          <div>
            <Label htmlFor="blur-thumbs" className="text-lg font-medium">Hide Episode Spoilers</Label>
            <p className="text-sm text-muted-foreground">Blur episode thumbnails to avoid spoilers.</p>
          </div>
          <Switch
            id="blur-thumbs"
            checked={config.blurThumbs}
            onCheckedChange={handleBlurThumbsChange}
          />
        </div>
        {/* Show Prefix Setting */}
        <div className="flex items-center justify-between p-4 rounded-lg border border-transparent hover:border-border hover:bg-accent transition-colors">
          <div>
            <Label htmlFor="show-prefix" className="text-lg font-medium">Show Prefix</Label>
            <p className="text-sm text-muted-foreground">Add "AIOMetadata - " prefix to all catalogs and search names.</p>
          </div>
          <Switch
            id="show-prefix"
            checked={config.showPrefix}
            onCheckedChange={handleShowPrefixChange}
          />
        </div>

        {/* Show Meta Provider Attribution Setting */}
        <div className="flex items-center justify-between p-4 rounded-lg border border-transparent hover:border-border hover:bg-accent transition-colors">
          <div>
            <Label htmlFor="show-meta-provider-attribution" className="text-lg font-medium">Show Meta Provider Attribution</Label>
            <p className="text-sm text-muted-foreground">Add "[Meta provided by Provider]" to the end of overview text.</p>
          </div>
          <Switch
            id="show-meta-provider-attribution"
            checked={config.showMetaProviderAttribution}
            onCheckedChange={handleShowMetaProviderAttributionChange}
          />
        </div>
        <div className="flex items-center justify-between p-4 rounded-lg border border-transparent hover:border-border hover:bg-accent transition-colors">
          <div>
            <Label htmlFor="cast-count" className="text-lg font-medium">Cast Members to Display</Label>
            <p className="text-sm text-muted-foreground">Number of cast members shown on a details page.</p>
          </div>
          <Select
            value={String(config.castCount ?? 0)}
            onValueChange={handleCastCountChange}
          >
            <SelectTrigger id="cast-count" className="w-[180px]">
              <SelectValue placeholder="Select count" />
            </SelectTrigger>
            <SelectContent>
              {castCountOptions.map(opt => (
                <SelectItem key={opt.value} value={String(opt.value)}>{opt.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        
      </div>
    </div>
  );
}
