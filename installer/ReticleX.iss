; ReticleX installer (Inno Setup 6)
;
; Installs per user by default, so no administrator prompt appears and each
; account keeps its own copy. The build script passes the version and the
; staged payload directory in; nothing here needs editing between releases.
;
;   iscc /DAppVersion=1.0.0 /DPayloadDir=..\build\publish installer\ReticleX.iss

#ifndef AppVersion
  #define AppVersion "1.0.0"
#endif
#ifndef PayloadDir
  #define PayloadDir "..\build\publish"
#endif
#ifndef OutputDir
  #define OutputDir "..\build\installer"
#endif

#define AppName        "ReticleX"
#define AppPublisher   "ReticleX"
#define AppUrl         "https://github.com/quantum3ap/reticlex"
#define AppExeName     "ReticleX.exe"

[Setup]
AppId={{7F1B6C42-9D3E-4C1A-9E77-2B5A0D8F1C31}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppUrl}
AppSupportURL={#AppUrl}/issues
AppUpdatesURL={#AppUrl}/releases
VersionInfoVersion={#AppVersion}
VersionInfoProductName={#AppName}
VersionInfoDescription={#AppName} crosshair design studio

; Per-user install: no elevation, no shared state.
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
DisableDirPage=no
AllowNoIcons=yes

OutputDir={#OutputDir}
OutputBaseFilename=ReticleX-v{#AppVersion}-Setup
SetupIconFile=..\desktop\csharp\ReticleX.App\Assets\reticlex.ico
UninstallDisplayIcon={app}\{#AppExeName}
UninstallDisplayName={#AppName}

Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
MinVersion=10.0.17763
CloseApplications=yes
RestartApplications=no

[Languages]
Name: "english";    MessagesFile: "compiler:Default.isl"
Name: "spanish";    MessagesFile: "compiler:Languages\Spanish.isl"
Name: "french";     MessagesFile: "compiler:Languages\French.isl"
Name: "german";     MessagesFile: "compiler:Languages\German.isl"
Name: "portuguese"; MessagesFile: "compiler:Languages\Portuguese.isl"
Name: "turkish";    MessagesFile: "compiler:Languages\Turkish.isl"
Name: "russian";    MessagesFile: "compiler:Languages\Russian.isl"
Name: "japanese";   MessagesFile: "compiler:Languages\Japanese.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; The staged publish output: the executable, the native core, the web front
; end, the translation catalogues and the built-in presets.
Source: "{#PayloadDir}\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\{#AppName}";           Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}";     Filename: "{app}\{#AppExeName}"; Tasks: desktopicon

[Registry]
; Lets an exported crosshair be opened with ReticleX from Explorer without
; taking over .json for the whole machine.
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExeName}\shell\open\command"; \
    ValueType: string; ValueName: ""; ValueData: """{app}\{#AppExeName}"" ""%1"""; Flags: uninsdeletekey
Root: HKCU; Subkey: "Software\Classes\Applications\{#AppExeName}\SupportedTypes"; \
    ValueType: string; ValueName: ".json"; ValueData: ""; Flags: uninsdeletekey

[Run]
Filename: "{app}\{#AppExeName}"; Description: "{cm:LaunchProgram,{#AppName}}"; \
    Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The browser profile the web view creates at runtime; the user's crosshairs
; in %APPDATA%\ReticleX are deliberately left alone.
Type: filesandordirs; Name: "{app}\app"

[Code]
const
  WebView2ClientsKey =
    'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function WebView2Installed: Boolean;
var
  Version: string;
begin
  { Evergreen WebView2 registers a per-machine or per-user version here. }
  Result :=
    (RegQueryStringValue(HKLM, WebView2ClientsKey, 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0')) or
    (RegQueryStringValue(HKCU, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}', 'pv', Version) and (Version <> '') and (Version <> '0.0.0.0'));
end;

function InitializeSetup: Boolean;
var
  Answer: Integer;
  ErrorCode: Integer;
begin
  Result := True;
  if WebView2Installed then
    Exit;

  { Windows 11 and up-to-date Windows 10 already have it; older machines need
    the runtime before ReticleX can draw anything. }
  Answer := MsgBox(
    'ReticleX needs the Microsoft Edge WebView2 runtime, which does not appear to be installed.' + #13#10#13#10 +
    'Open the download page now? Setup will continue either way.',
    mbConfirmation, MB_YESNO);

  if Answer = IDYES then
    ShellExec('open', 'https://go.microsoft.com/fwlink/p/?LinkId=2124703', '', '', SW_SHOW, ewNoWait, ErrorCode);
end;
