import { useState, useEffect } from "react";
import { useConfig } from "@/contexts/ConfigContext";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Download, Upload, FileText, Shield, AlertCircle, Loader2, Trash2, Lock } from "lucide-react";
import { toast } from "sonner";
import { ConfirmDialog } from "@/components/ConfirmDialog";

export function ConfigImportExport() {
  const { config, setConfig, resetConfig: resetConfigFromContext, auth, setAuth } = useConfig();
  const [excludeApiKeys, setExcludeApiKeys] = useState(true);
  const [isExporting, setIsExporting] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [addonVersion, setAddonVersion] = useState("");
  const [showResetDialog, setShowResetDialog] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);
  const [showPasswordDialog, setShowPasswordDialog] = useState(false);
  const [deletePassword, setDeletePassword] = useState('');


  useEffect(() => {
    fetch("/api/config/addon-info")
      .then(res => res.json())
      .then(data => setAddonVersion(data.addonVersion || "unknown"))
      .catch(() => setAddonVersion("unknown"));
  }, []);

  const exportConfig = () => {
    setIsExporting(true);
    try {
      // Create a copy of the config
      const configToExport = { ...config };
      
      // Remove API keys if requested
      if (excludeApiKeys) {
        configToExport.apiKeys = {
          gemini: "",
          tmdb: "",
          tvdb: "",
          fanart: "",
          rpdb: "",
          mdblist: ""
        };
      }

      // Create the export data
      const exportData = {
        version: addonVersion,
        exportedAt: new Date().toISOString(),
        config: configToExport,
        metadata: {
          apiKeysExcluded: excludeApiKeys,
          totalCatalogs: config.catalogs?.length || 0,
          enabledCatalogs: config.catalogs?.filter(c => c.enabled).length || 0
        }
      };

      // Create and download the file
      const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `aiometadata-config-${new Date().toISOString().split('T')[0]}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast.success("Configuration exported successfully!", {
        description: excludeApiKeys ? "API keys were excluded from export" : "Full configuration exported"
      });
    } catch (error) {
      console.error('Export error:', error);
      toast.error("Failed to export configuration", {
        description: "Please try again"
      });
    } finally {
      setIsExporting(false);
    }
  };

  const importConfig = () => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = async (event) => {
      const file = (event.target as HTMLInputElement).files?.[0];
      if (!file) return;

      setIsImporting(true);
      try {
        const text = await file.text();
        const importData = JSON.parse(text);

        // Validate the import data
        if (!importData.config || !importData.version) {
          throw new Error("Invalid configuration file format");
        }

        // Check if this is a different version (basic version check)
        if (importData.version !== addonVersion) {
          toast.warning("Configuration file version mismatch", {
            description: `This file was exported from version ${importData.version}, but you're running ${addonVersion}. Some settings may not import correctly.`
          });
        }

        // Merge the imported config with current config
        // Preserve current API keys if they were excluded from export
        const mergedConfig = {
          ...config,
          ...importData.config,
          apiKeys: importData.metadata?.apiKeysExcluded ? config.apiKeys : importData.config.apiKeys
        };

        // Update the configuration
        setConfig(mergedConfig);

        toast.success("Configuration imported successfully!", {
          description: `Imported ${importData.metadata?.enabledCatalogs || 0} enabled catalogs`
        });

        // Show summary of what was imported
        const summary = {
          catalogs: importData.config.catalogs?.length || 0,
          enabledCatalogs: importData.config.catalogs?.filter((c: any) => c.enabled).length || 0,
          apiKeysIncluded: !importData.metadata?.apiKeysExcluded,
          language: importData.config.language,
          providers: importData.config.providers
        };

        console.log('Import summary:', summary);

      } catch (error) {
        console.error('Import error:', error);
        toast.error("Failed to import configuration", {
          description: error instanceof Error ? error.message : "Invalid file format"
        });
      } finally {
        setIsImporting(false);
      }
    };
    input.click();
  };

  const resetConfig = () => {
    setShowResetDialog(true);
  };

  const handleResetConfirm = () => {
    resetConfigFromContext();
    toast.success("Configuration reset to defaults");
  };

  const deleteUserRecords = async () => {
    if (!auth.userUUID) {
      toast.error("No user account found", {
        description: "You must be logged in to delete your records"
      });
      return;
    }

    setShowPasswordDialog(true);
  };

  const handlePasswordConfirm = async () => {
    if (!deletePassword.trim()) {
      toast.error("Password is required", {
        description: "Please enter your password to confirm deletion"
      });
      return;
    }

    setShowPasswordDialog(false);
    setShowDeleteDialog(true);
  };

  const handleDeleteConfirm = async () => {
    setIsDeleting(true);
    try {
      const response = await fetch(`/api/config/delete-user/${encodeURIComponent(auth.userUUID)}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          password: deletePassword
        })
      });

      if (response.ok) {
        toast.success("User records deleted successfully", {
          description: "You have been logged out and all your data has been removed"
        });
        
        // Clear auth state and redirect to home
        setAuth({ authenticated: false, userUUID: null, password: null });
        window.location.href = '/configure';
      } else {
        const error = await response.json();
        throw new Error(error.error || 'Failed to delete user records');
      }
    } catch (error) {
      console.error('Delete user error:', error);
      toast.error("Failed to delete user records", {
        description: error instanceof Error ? error.message : "Please try again"
      });
    } finally {
      setIsDeleting(false);
      setDeletePassword('');
    }
  };



  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold">Import & Export</h2>
        <p className="text-muted-foreground mt-1">
          Backup your configuration or import settings from another device.
        </p>
      </div>

      <div className="grid gap-6 md:grid-cols-2">
        {/* Export Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Download className="h-5 w-5" />
              Export Configuration
            </CardTitle>
            <CardDescription>
              Download your current configuration as a JSON file for backup or sharing.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center space-x-2">
              <Switch
                id="exclude-api-keys"
                checked={excludeApiKeys}
                onCheckedChange={setExcludeApiKeys}
              />
              <Label htmlFor="exclude-api-keys" className="flex items-center gap-2">
                <Shield className="h-4 w-4" />
                Exclude API keys from export
              </Label>
            </div>
            
            <div className="text-sm text-muted-foreground">
              {excludeApiKeys ? (
                <div className="flex items-start gap-2">
                  <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500" />
                  <span>API keys will be excluded for security. You'll need to re-enter them after import.</span>
                </div>
              ) : (
                <div className="flex items-start gap-2">
                  <FileText className="h-4 w-4 mt-0.5 text-blue-500" />
                  <span>Full configuration including API keys will be exported.</span>
                </div>
              )}
            </div>

            <Button 
              onClick={exportConfig} 
              disabled={isExporting}
              className="w-full"
            >
              {isExporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Exporting...
                </>
              ) : (
                <>
                  <Download className="mr-2 h-4 w-4" />
                  Export Configuration
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {/* Import Section */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Upload className="h-5 w-5" />
              Import Configuration
            </CardTitle>
            <CardDescription>
              Import a previously exported configuration file.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="text-sm text-muted-foreground">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 text-amber-500" />
                <span>This will replace your current configuration. Make sure to backup first.</span>
              </div>
            </div>

            <Button 
              onClick={importConfig} 
              disabled={isImporting}
              variant="outline"
              className="w-full"
            >
              {isImporting ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Importing...
                </>
              ) : (
                <>
                  <Upload className="mr-2 h-4 w-4" />
                  Import Configuration
                </>
              )}
            </Button>
          </CardContent>
        </Card>
      </div>

      {/* Danger Zone */}
      <Card className="border-destructive/20">
        <CardHeader>
          <CardTitle className="text-destructive">Danger Zone</CardTitle>
          <CardDescription>
            Irreversible actions that will affect your configuration and account.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <Button 
              onClick={resetConfig} 
              variant="destructive"
              className="w-full"
            >
              Reset to Defaults
            </Button>
            <p className="text-xs text-muted-foreground mt-1">
              Reset your configuration to default values. This action cannot be undone.
            </p>
          </div>
          
          {auth.authenticated && auth.userUUID && (
            <div>
              <Button 
                onClick={deleteUserRecords}
                disabled={isDeleting}
                variant="destructive"
                className="w-full"
              >
                {isDeleting ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Deleting...
                  </>
                ) : (
                  <>
                    <Trash2 className="mr-2 h-4 w-4" />
                    Delete User Records
                  </>
                )}
              </Button>
              <p className="text-xs text-muted-foreground mt-1">
                Permanently delete your user account and all associated data. This action cannot be undone.
              </p>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Confirmation Dialogs */}
      <ConfirmDialog
        isOpen={showResetDialog}
        onClose={() => setShowResetDialog(false)}
        onConfirm={handleResetConfirm}
        title="Reset Configuration"
        description="Are you sure you want to reset your configuration to defaults?\n\nThis action cannot be undone."
        confirmText="Reset to Defaults"
        variant="destructive"
      />

      <ConfirmDialog
        isOpen={showDeleteDialog}
        onClose={() => setShowDeleteDialog(false)}
        onConfirm={handleDeleteConfirm}
        title="Delete User Records"
        description={`⚠️ WARNING: This will permanently delete ALL your data!

• Your user account
• Your configuration
• Your saved settings
• All associated data

This action CANNOT be undone. Are you absolutely sure?`}
        confirmText="Delete All Data"
        variant="destructive"
        icon={<Trash2 className="h-5 w-5 text-destructive" />}
      />

      {/* Password Dialog */}
      <Dialog open={showPasswordDialog} onOpenChange={setShowPasswordDialog}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-destructive" />
              Confirm Password
            </DialogTitle>
            <DialogDescription>
              Please enter your password to confirm the deletion of your user account and all associated data.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="delete-password">Password</Label>
              <Input
                id="delete-password"
                type="password"
                value={deletePassword}
                onChange={(e) => setDeletePassword(e.target.value)}
                placeholder="Enter your password"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    handlePasswordConfirm();
                  }
                }}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowPasswordDialog(false)}>
              Cancel
            </Button>
            <Button 
              variant="destructive" 
              onClick={handlePasswordConfirm}
              disabled={!deletePassword.trim()}
            >
              Confirm Password
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
