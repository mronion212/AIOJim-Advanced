import React, { useState, useMemo } from 'react';
import { MDBListIntegration } from './MDBListIntegration';
import { StremThruIntegration } from './StremThruIntegration';
import { useConfig, CatalogConfig } from '@/contexts/ConfigContext';
import { DndContext, closestCenter, KeyboardSensor, PointerSensor, useSensor, useSensors, DragEndEvent } from '@dnd-kit/core';
import { arrayMove, SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Eye, EyeOff, Home, GripVertical, RefreshCw, Trash2 } from 'lucide-react';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogClose } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { streamingServices, regions } from "@/data/streamings";
import { allCatalogDefinitions } from '@/data/catalogs';

const groupBySource = (catalogs: CatalogConfig[]) => {
  return catalogs.reduce((acc, cat) => {
    const key = cat.source || 'Other';
    if (!acc[key]) acc[key] = [];
    acc[key].push(cat);
    return acc;
  }, {} as Record<string, CatalogConfig[]>);
};

const sourceBadgeStyles = {
  tmdb: "bg-blue-800/80 text-blue-200 border-blue-600/50 hover:bg-blue-800",
  tvdb: "bg-green-800/80 text-green-200 border-green-600/50 hover:bg-green-800",
  mal: "bg-indigo-800/80 text-indigo-200 border-indigo-600/50 hover:bg-indigo-800",
  mdblist: "bg-yellow-800/80 text-yellow-200 border-yellow-600/50 hover:bg-yellow-800",
  stremthru: "bg-purple-800/80 text-purple-200 border-purple-600/50 hover:bg-purple-800",
};

const CollapsibleSection = ({ title, children }: { title: string, children: React.ReactNode }) => {
  const [open, setOpen] = useState(true);
  return (
    <div className="mb-4">
      <button onClick={() => setOpen((o) => !o)} className="font-bold text-lg mb-2">
        {open ? "\u25bc" : "\u25ba"} {title}
      </button>
      {open && <div className="pl-4">{children}</div>}
    </div>
  );
};

const SortableCatalogItem = ({ catalog }: { catalog: CatalogConfig & { source?: string }; }) => {
  const { setConfig } = useConfig();
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: `${catalog.id}-${catalog.type}` });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : 'auto',
  };
  
  const badgeSource = catalog.source || 'custom';
  const badgeStyle = sourceBadgeStyles[badgeSource as keyof typeof sourceBadgeStyles] || "bg-gray-700";

  const handleToggleEnabled = () => {
    setConfig(prev => ({
      ...prev,
      catalogs: prev.catalogs.map(c => {
        if (c.id === catalog.id && c.type === catalog.type) {
          const isNowEnabled = !c.enabled;
          return { ...c, enabled: isNowEnabled, showInHome: isNowEnabled ? c.showInHome : false };
        }
        return c;
      })
    }));
  };

  const handleToggleShowInHome = () => {
    if (!catalog.enabled) return;
    setConfig(prev => ({
      ...prev,
      catalogs: prev.catalogs.map(c =>
        (c.id === catalog.id && c.type === catalog.type) ? { ...c, showInHome: !c.showInHome } : c
      )
    }));
  };

  const handleDelete = () => {
    setConfig(prev => ({
      ...prev,
      catalogs: prev.catalogs.filter(c => !(c.id === catalog.id && c.type === catalog.type)),
    }));
  };

  const handleMoveToTop = () => {
    setConfig(prev => {
      const currentIndex = prev.catalogs.findIndex(c => c.id === catalog.id && c.type === catalog.type);
      if (currentIndex <= 0) return prev; // Already at top or not found
      
      const newCatalogs = [...prev.catalogs];
      const [movedCatalog] = newCatalogs.splice(currentIndex, 1);
      newCatalogs.unshift(movedCatalog);
      
      return {
        ...prev,
        catalogs: newCatalogs,
      };
    });
  };

  const handleMoveToBottom = () => {
    setConfig(prev => {
      const currentIndex = prev.catalogs.findIndex(c => c.id === catalog.id && c.type === catalog.type);
      if (currentIndex === -1 || currentIndex === prev.catalogs.length - 1) return prev; // Not found or already at bottom
      
      const newCatalogs = [...prev.catalogs];
      const [movedCatalog] = newCatalogs.splice(currentIndex, 1);
      newCatalogs.push(movedCatalog);
      
      return {
        ...prev,
        catalogs: newCatalogs,
      };
    });
  };

  return (
    <Card
      ref={setNodeRef}
      style={style}
      className={`flex items-center justify-between p-4 transition-all duration-200
        ${isDragging ? 'opacity-50 scale-105 shadow-lg' : ''}
        ${!catalog.enabled ? 'opacity-60' : ''}
      `}
    >
      <div className="flex items-center space-x-4">
        <button {...attributes} {...listeners} className="cursor-grab text-muted-foreground p-2 -ml-2 touch-none" aria-label="Drag to reorder">
          <GripVertical />
        </button>
        <div className="flex-shrink-0">
          <Badge variant="outline" className={`font-semibold ${badgeStyle}`}>
            {badgeSource.toUpperCase()}
          </Badge>
        </div>
        <div>
          <p className={`font-medium transition-colors ${catalog.enabled ? 'text-foreground' : 'text-muted-foreground'}`}>{catalog.name}</p>
          <p className={`text-sm transition-colors ${catalog.enabled ? 'text-muted-foreground' : 'text-muted-foreground/50'} capitalize`}>{catalog.type}</p>
        </div>
      </div>

      <div className="flex items-center space-x-2">
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleToggleEnabled}>
                {catalog.enabled ? (
                  <Eye className="h-5 w-5 text-green-500 dark:text-green-400" />
                ) : (
                  <EyeOff className="h-5 w-5 text-muted-foreground" />
                )}
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{catalog.enabled ? 'Enabled (Visible)' : 'Disabled'}</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleToggleShowInHome}
                disabled={!catalog.enabled}
                className="disabled:opacity-20 disabled:cursor-not-allowed"
              >
                <Home className={`h-5 w-5 transition-colors ${catalog.showInHome && catalog.enabled ? 'text-blue-500 dark:text-blue-400' : 'text-muted-foreground'}`} />
              </Button>
            </TooltipTrigger>
            <TooltipContent><p>{catalog.showInHome && catalog.enabled ? 'Featured on Home Board' : 'Not on Home Board'}</p></TooltipContent>
          </Tooltip>

          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleMoveToTop} aria-label="Move to Top" className="h-8 w-8">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" className="text-muted-foreground hover:text-foreground" fill="currentColor">
                  <path d="M213.66,194.34a8,8,0,0,1-11.32,11.32L128,131.31,53.66,205.66a8,8,0,0,1-11.32-11.32l80-80a8,8,0,0,1,11.32,0Zm-160-68.68L128,51.31l74.34,74.35a8,8,0,0,0,11.32-11.32l-80-80a8,8,0,0,0-11.32,0l-80,80a8,8,0,0,0,11.32,11.32Z" />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Move to top of list</TooltipContent>
          </Tooltip>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button variant="ghost" size="icon" onClick={handleMoveToBottom} aria-label="Move to Bottom" className="h-8 w-8">
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 256 256" className="text-muted-foreground hover:text-foreground" fill="currentColor">
                  <path d="M213.66,130.34a8,8,0,0,1,0,11.32l-80,80a8,8,0,0,1-11.32,0l-80-80a8,8,0,0,1,11.32-11.32L128,204.69l74.34-74.35A8,8,0,0,1,213.66,130.34Zm-91.32,11.32a8,8,0,0,0,11.32,0l80-80a8,8,0,0,0-11.32-11.32L128,124.69,53.66,50.34A8,8,0,0,0,42.34,61.66Z" />
                </svg>
              </Button>
            </TooltipTrigger>
            <TooltipContent>Move to bottom of list</TooltipContent>
          </Tooltip>
         

          {(catalog.source === 'mdblist' || catalog.source === 'streaming' || catalog.source === 'stremthru') && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleDelete} aria-label="Delete Catalog">
                  <Trash2 className="h-5 w-5 text-red-500" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Remove from your catalog list</TooltipContent>
            </Tooltip>
          )}
        </TooltipProvider>
      </div>
    </Card>
  );
};

const StreamingProvidersSettings = ({ open, onClose, selectedProviders, setSelectedProviders, onSave }) => {
  const [selectedCountry, setSelectedCountry] = useState('Any');

  const showProvider = (serviceId: string) => {
    const countryList = regions[selectedCountry as keyof typeof regions];
    return Array.isArray(countryList) && countryList.includes(serviceId);
  };

  const toggleService = (serviceId: string) => {
    setSelectedProviders((prev: string[] = []) =>
      Array.isArray(prev) && prev.includes(serviceId)
        ? prev.filter(id => id !== serviceId)
        : [...(prev || []), serviceId]
    );
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Manage Streaming Providers</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <p className="text-sm text-muted-foreground mb-2">Filter providers by country:</p>
            <Select value={selectedCountry} onValueChange={setSelectedCountry}>
              <SelectTrigger className="bg-background">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border shadow-md">
                {Object.keys(regions).map((country) => (
                  <SelectItem key={country} value={country} className="cursor-pointer">
                    {country}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="grid grid-cols-5 gap-4">
            {streamingServices.map((service) => (
              showProvider(service.id) && (
                <button
                  key={service.id}
                  onClick={() => toggleService(service.id)}
                  className={`w-12 h-12 sm:w-14 sm:h-14 rounded-xl border transition-opacity ${
                    Array.isArray(selectedProviders) && selectedProviders.includes(service.id)
                      ? "border-primary bg-primary/5"
                      : "border-border opacity-50 hover:opacity-100"
                  }`}
                  title={service.name}
                >
                  <img
                    src={service.icon}
                    alt={service.name}
                    className="w-full h-full rounded-lg object-cover"
                  />
                </button>
              )
            ))}
          </div>
          <div className="flex justify-end gap-2">
            <DialogClose asChild>
              <Button variant="outline" type="button" onClick={onClose}>
                Cancel
              </Button>
            </DialogClose>
            <Button type="button" onClick={onSave}>
              Save Changes
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export function CatalogsSettings() {
  const { config, setConfig } = useConfig();
  const [isMdbListOpen, setIsMdbListOpen] = useState(false);
  const [isStremThruOpen, setIsStremThruOpen] = useState(false);
  const [streamingDialogOpen, setStreamingDialogOpen] = useState(false);
  const [tempSelectedProviders, setTempSelectedProviders] = useState<string[]>([]);
  const sensors = useSensors(useSensor(PointerSensor), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  const filteredCatalogs = useMemo(() =>
    config.catalogs.filter(cat => {
      if (cat.source !== "streaming") return true;
      const serviceId = cat.id.replace("streaming.", "").replace(/ .*/, "");
      return Array.isArray(config.streaming) && config.streaming.includes(serviceId);
    }),
    [config.catalogs, config.streaming]
  );

  const handleDragEnd = (event: DragEndEvent) => {
    const { active, over } = event;
    if (over && active.id !== over.id) {
      setConfig(prev => {
        const oldIndex = prev.catalogs.findIndex(c => `${c.id}-${c.type}` === active.id);
        const newIndex = prev.catalogs.findIndex(c => `${c.id}-${c.type}` === over.id);
        return { ...prev, catalogs: arrayMove(prev.catalogs, oldIndex, newIndex) };
      });
    }
  };

  const catalogItemIds = filteredCatalogs.map(c => `${c.id}-${c.type}`);

  // Helper function to get actual selected streaming services from catalogs
  const getActualSelectedStreamingServices = (): string[] => {
    const streamingCatalogs = config.catalogs?.filter(c => c.source === 'streaming' && c.enabled) || [];
    const serviceIds = new Set<string>();
    
    streamingCatalogs.forEach(catalog => {
      const serviceId = catalog.id.replace('streaming.', '');
      serviceIds.add(serviceId);
    });
    
    return Array.from(serviceIds);
  };

  const handleOpenStreamingDialog = () => {
    // Only show services as selected if they have enabled catalogs
    const enabledStreamingServices = getActualSelectedStreamingServices();
    setTempSelectedProviders(enabledStreamingServices);
    setStreamingDialogOpen(true);
  };

  const handleCloseStreamingDialog = () => {
    console.log('🔗 [Streaming] Saving with selectedServices:', tempSelectedProviders);
    setConfig(prev => {
      const selectedServices = tempSelectedProviders;
      
      let newCatalogs = [...prev.catalogs];
      
      // Get all streaming services that currently have catalogs
      const currentStreamingServices = new Set<string>();
      prev.catalogs.forEach(catalog => {
        if (catalog.source === 'streaming') {
          const serviceId = catalog.id.replace('streaming.', '');
          currentStreamingServices.add(serviceId);
        }
      });
      
      // Remove catalogs for services that are no longer selected
      currentStreamingServices.forEach(serviceId => {
        if (!selectedServices.includes(serviceId)) {
          ['movie', 'series'].forEach(type => {
            const catalogId = `streaming.${serviceId}`;
            
            // Remove from catalogs
            newCatalogs = newCatalogs.filter(c => !(c.id === catalogId && c.type === type));
          });
        }
      });
      
      // Add catalogs for newly selected services
      selectedServices.forEach(serviceId => {
        if (!currentStreamingServices.has(serviceId)) {
          // Add new catalogs
          ['movie', 'series'].forEach(type => {
            const catalogId = `streaming.${serviceId}`;
            
            // Add new catalog - always enable when user explicitly adds it
            const def = allCatalogDefinitions.find(c => c.id === catalogId && c.type === type);
            if (def) {
              newCatalogs.push({
                id: def.id,
                name: def.name,
                type: def.type,
                source: def.source,
                enabled: true,
                showInHome: true,
              });
            }
          });
        } else {
          // Enable existing catalogs
          ['movie', 'series'].forEach(type => {
            const catalogId = `streaming.${serviceId}`;
            const existingCatalogIndex = newCatalogs.findIndex(c => c.id === catalogId && c.type === type);
            if (existingCatalogIndex !== -1) {
              console.log('🔗 [Streaming] Enabling existing catalog:', catalogId);
              newCatalogs[existingCatalogIndex] = {
                ...newCatalogs[existingCatalogIndex],
                enabled: true,
                showInHome: true,
              };
            }
          });
        }
      });
      
      return {
        ...prev,
        streaming: selectedServices,
        catalogs: newCatalogs,
      };
    });
    setStreamingDialogOpen(false);
  };

  const handleReloadCatalogs = () => {
    setConfig(prev => {
      const defaultCatalogs = allCatalogDefinitions.map(c => ({
        id: c.id,
        name: c.name,
        type: c.type,
        source: c.source,
        enabled: c.isEnabledByDefault || false,
        showInHome: c.showOnHomeByDefault || false,
      }));
      const userCatalogSettings = new Map(
        prev.catalogs.map(c => [`${c.id}-${c.type}`, { enabled: c.enabled, showInHome: c.showInHome }])
      );
      const userCatalogKeys = new Set(prev.catalogs.map(c => `${c.id}-${c.type}`));
      const missingCatalogs = defaultCatalogs.filter(def => !userCatalogKeys.has(`${def.id}-${def.type}`));
      const mergedCatalogs = [
        ...prev.catalogs,
        ...missingCatalogs
      ];
      const hydratedCatalogs = mergedCatalogs.map(defaultCatalog => {
        const key = `${defaultCatalog.id}-${defaultCatalog.type}`;
        if (userCatalogSettings.has(key)) {
          return { ...defaultCatalog, ...userCatalogSettings.get(key) };
        }
        return defaultCatalog;
      });
      return {
        ...prev,
        catalogs: hydratedCatalogs,
      };
    });
  };

  return (
    <div className="space-y-8 animate-fade-in">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div className="space-y-1">
          <h2 className="text-2xl font-semibold">Catalog Management</h2>
          <p className="text-muted-foreground">
            Drag to reorder. Click icons to toggle visibility.
          </p>
          <div className="flex items-center space-x-4 pt-2 text-sm text-muted-foreground">
            <div className="flex items-center gap-1.5">
              <Eye className="h-4 w-4 text-green-500 dark:text-green-400"/> Enabled
            </div>
            <div className="flex items-center gap-1.5">
              <Home className="h-4 w-4 text-blue-500 dark:text-blue-400"/> On Home Board
            </div>
          </div>
        </div>
        <div className="flex-shrink-0 flex flex-wrap gap-2">
          <Button onClick={handleOpenStreamingDialog} className="flex-1 sm:flex-none min-w-0">
            <span className="truncate">Manage Streaming Providers</span>
          </Button>
          <Button onClick={() => setIsMdbListOpen(true)} className="flex-1 sm:flex-none min-w-0">
            <span className="truncate">Manage MDBList Integration</span>
          </Button>
          <Button onClick={() => setIsStremThruOpen(true)} className="flex-1 sm:flex-none min-w-0">
            <span className="truncate">Import StremThru Catalogs</span>
          </Button>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button variant="ghost" size="icon" onClick={handleReloadCatalogs} aria-label="Reload Catalogs" className="flex-shrink-0">
                  <RefreshCw className="w-5 h-5" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Refresh catalogs to look for updates</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
        <SortableContext items={catalogItemIds} strategy={verticalListSortingStrategy}>
          <div className="space-y-4">
            {filteredCatalogs.map((catalog) => (
              <SortableCatalogItem key={`${catalog.id}-${catalog.type}`} catalog={catalog} />
            ))}
          </div>
        </SortableContext>
      </DndContext>
      <StreamingProvidersSettings
        open={streamingDialogOpen}
        onClose={() => setStreamingDialogOpen(false)}
        selectedProviders={tempSelectedProviders}
        setSelectedProviders={setTempSelectedProviders}
        onSave={handleCloseStreamingDialog}
      />
      <MDBListIntegration
        isOpen={isMdbListOpen}
        onClose={() => setIsMdbListOpen(false)}
      />
      <StremThruIntegration
        isOpen={isStremThruOpen}
        onClose={() => setIsStremThruOpen(false)}
      />
    </div>
  );
}