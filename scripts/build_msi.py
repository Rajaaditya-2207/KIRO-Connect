"""
Compiles a production Windows MSI Installer for KIRO-Connect using the standalone
integrated executable (KIRO-Connect.exe) and WiX Toolset.
"""
import os
import sys
import subprocess
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WIX_BIN = Path(os.environ.get("LOCALAPPDATA", "")) / "tauri" / "WixTools314"
CANDLE = WIX_BIN / "candle.exe"
LIGHT = WIX_BIN / "light.exe"

def ensure_tools():
    if not CANDLE.exists() or not LIGHT.exists():
        raise FileNotFoundError(f"WiX binaries not found in {WIX_BIN}")

def create_license_rtf(dest_path: Path):
    rtf_content = r"{\rtf1\ansi\deff0 {\fonttbl{\f0 Segoe UI;}}\f0\fs20 KIRO-Connect - P2P Mixture-of-Agents Swarm\par Open-Source Software Under MIT License.\par All rights reserved.\par}"
    dest_path.write_text(rtf_content, encoding="utf-8")

def build_msi():
    ensure_tools()
    
    release_dir = ROOT / "release"
    release_dir.mkdir(exist_ok=True)
    
    exe_path = release_dir / "KIRO-Connect.exe"
    if not exe_path.exists():
        raise FileNotFoundError(f"Missing required binary: {exe_path}")

    icon_path = ROOT / "src-tauri" / "icons" / "icon.ico"
    license_rtf = release_dir / "License.rtf"
    create_license_rtf(license_rtf)

    wxs_path = release_dir / "KIRO-Connect.wxs"
    wix_obj = release_dir / "KIRO-Connect.wixobj"
    msi_out = release_dir / "KIRO-Connect-Setup.msi"

    wxs_content = f"""<?xml version="1.0" encoding="UTF-8"?>
<Wix xmlns="http://schemas.microsoft.com/wix/2006/wi">
  <Product Id="*"
           Name="KIRO-Connect"
           Language="1033"
           Version="0.1.0"
           Manufacturer="KIRO Team"
           UpgradeCode="4C6D85FA-60D6-4A73-BE94-68FEA091A25F">
    
    <Package InstallerVersion="200" Compressed="yes" InstallScope="perMachine" Platform="x64" />

    <MajorUpgrade DowngradeErrorMessage="A newer version of KIRO-Connect is already installed." />
    <MediaTemplate EmbedCab="yes" />

    <Icon Id="AppIcon" SourceFile="{icon_path}" />
    <Property Id="ARPPRODUCTICON" Value="AppIcon" />

    <Directory Id="TARGETDIR" Name="SourceDir">
      <Directory Id="ProgramFiles64Folder">
        <Directory Id="INSTALLDIR" Name="KIRO-Connect">
          <Component Id="MainExecutable" Guid="3E49E067-BD29-456B-8833-28D8A7CE7876" Win64="yes">
            <File Id="KiroConnectExe" Source="{exe_path}" KeyPath="yes" Checksum="yes" />
          </Component>
        </Directory>
      </Directory>

      <Directory Id="ProgramMenuFolder">
        <Directory Id="ApplicationProgramsFolder" Name="KIRO-Connect">
          <Component Id="ApplicationShortcut" Guid="7AF6F868-8CF6-48BD-BE22-0744BE43D0C3">
            <Shortcut Id="ApplicationStartMenuShortcut"
                      Name="KIRO-Connect"
                      Description="LAN Mixture-of-Agents Swarm Orchestrator"
                      Target="[INSTALLDIR]KIRO-Connect.exe"
                      WorkingDirectory="INSTALLDIR"
                      Icon="AppIcon" />
            <RemoveFolder Id="CleanUpShortCut" Directory="ApplicationProgramsFolder" On="uninstall" />
            <RegistryValue Root="HKCU" Key="Software\\KIRO-Connect" Name="installed" Type="integer" Value="1" KeyPath="yes" />
          </Component>
        </Directory>
      </Directory>

      <Directory Id="DesktopFolder" Name="Desktop">
        <Component Id="DesktopShortcutComponent" Guid="F9F7A206-EE6A-460B-9799-E2DC9F4BE68B">
          <Shortcut Id="ApplicationDesktopShortcut"
                    Name="KIRO-Connect"
                    Description="LAN Mixture-of-Agents Swarm Orchestrator"
                    Target="[INSTALLDIR]KIRO-Connect.exe"
                    WorkingDirectory="INSTALLDIR"
                    Icon="AppIcon" />
          <RegistryValue Root="HKCU" Key="Software\\KIRO-Connect" Name="desktop_shortcut" Type="integer" Value="1" KeyPath="yes" />
        </Component>
      </Directory>
    </Directory>

    <Feature Id="MainApplication" Title="KIRO-Connect" Level="1">
      <ComponentRef Id="MainExecutable" />
      <ComponentRef Id="ApplicationShortcut" />
      <ComponentRef Id="DesktopShortcutComponent" />
    </Feature>

    <UIRef Id="WixUI_Minimal" />
    <WixVariable Id="WixUILicenseRtf" Value="{license_rtf}" />
  </Product>
</Wix>
"""
    wxs_path.write_text(wxs_content, encoding="utf-8")
    print(f"Generated WiX definition at {wxs_path}")

    # Compile with candle
    print("Compiling WiX definition with candle.exe...")
    candle_cmd = [
        str(CANDLE),
        "-arch", "x64",
        "-out", str(wix_obj),
        str(wxs_path)
    ]
    subprocess.run(candle_cmd, check=True)

    # Link with light
    print("Linking MSI package with light.exe...")
    light_cmd = [
        str(LIGHT),
        "-ext", "WixUIExtension",
        "-out", str(msi_out),
        str(wix_obj)
    ]
    subprocess.run(light_cmd, check=True)

    # Clean intermediate files
    wxs_path.unlink(missing_ok=True)
    wix_obj.unlink(missing_ok=True)
    license_rtf.unlink(missing_ok=True)
    (release_dir / "KIRO-Connect-Setup.wixpdb").unlink(missing_ok=True)

    print(f"\nMSI compilation successful! Created: {msi_out} ({msi_out.stat().st_size / (1024*1024):.2f} MB)")

if __name__ == "__main__":
    build_msi()
