param([switch]$Unmute, [switch]$UseSpeakers)
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
namespace LocalAudio {
    [ComImport, Guid("870AF99C-171D-4F9E-AF0D-E63DF40C2BC9")]
    class PolicyConfig {}
    [ComImport, Guid("F8679F50-850A-41CF-9C72-430F290290C8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IPolicyConfig {
        [PreserveSig] int GetMixFormat(string id, out IntPtr format);
        [PreserveSig] int GetDeviceFormat(string id, int defaultFormat, out IntPtr format);
        [PreserveSig] int ResetDeviceFormat(string id);
        [PreserveSig] int SetDeviceFormat(string id, IntPtr endpointFormat, IntPtr mixFormat);
        [PreserveSig] int GetProcessingPeriod(string id, int defaultPeriod, out long period, out long minimum);
        [PreserveSig] int SetProcessingPeriod(string id, ref long period);
        [PreserveSig] int GetShareMode(string id, IntPtr mode);
        [PreserveSig] int SetShareMode(string id, IntPtr mode);
        [PreserveSig] int GetPropertyValue(string id, IntPtr key, IntPtr value);
        [PreserveSig] int SetPropertyValue(string id, IntPtr key, IntPtr value);
        [PreserveSig] int SetDefaultEndpoint([MarshalAs(UnmanagedType.LPWStr)] string id, int role);
        [PreserveSig] int SetEndpointVisibility(string id, int visible);
    }
    [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")]
    class Enumerator {}
    [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IEnumerator {
        [PreserveSig] int EnumAudioEndpoints(int flow, uint mask, out IntPtr devices);
        [PreserveSig] int GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
    }
    [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IDevice {
        [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr activation, [MarshalAs(UnmanagedType.IUnknown)] out object instance);
        [PreserveSig] int OpenPropertyStore(uint access, out IntPtr properties);
        [PreserveSig] int GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
        [PreserveSig] int GetState(out uint state);
    }
    [ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IVolume {
        [PreserveSig] int RegisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int UnregisterControlChangeNotify(IntPtr notify);
        [PreserveSig] int GetChannelCount(out uint count);
        [PreserveSig] int SetMasterVolumeLevel(float level, ref Guid context);
        [PreserveSig] int SetMasterVolumeLevelScalar(float level, ref Guid context);
        [PreserveSig] int GetMasterVolumeLevel(out float level);
        [PreserveSig] int GetMasterVolumeLevelScalar(out float level);
        [PreserveSig] int SetChannelVolumeLevel(uint channel, float level, ref Guid context);
        [PreserveSig] int SetChannelVolumeLevelScalar(uint channel, float level, ref Guid context);
        [PreserveSig] int GetChannelVolumeLevel(uint channel, out float level);
        [PreserveSig] int GetChannelVolumeLevelScalar(uint channel, out float level);
        [PreserveSig] int SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
        [PreserveSig] int GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
    }
    public class Probe {
        public static void SetOutput(string id) {
            var config = (IPolicyConfig)new PolicyConfig();
            Marshal.ThrowExceptionForHR(config.SetDefaultEndpoint(id, 0));
            Marshal.ThrowExceptionForHR(config.SetDefaultEndpoint(id, 1));
        }
        public string DeviceId;
        public bool MutedBefore, MutedAfter;
        public float VolumeBefore, VolumeAfter;
        public static Probe Run(bool unmute) {
            IDevice device;
            Marshal.ThrowExceptionForHR(((IEnumerator)new Enumerator()).GetDefaultAudioEndpoint(0, 1, out device));
            var result = new Probe();
            Marshal.ThrowExceptionForHR(device.GetId(out result.DeviceId));
            Guid iid = typeof(IVolume).GUID;
            object instance;
            Marshal.ThrowExceptionForHR(device.Activate(ref iid, 23, IntPtr.Zero, out instance));
            var volume = (IVolume)instance;
            Marshal.ThrowExceptionForHR(volume.GetMute(out result.MutedBefore));
            Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out result.VolumeBefore));
            if (unmute) {
                Guid context = Guid.Empty;
                if (result.MutedBefore) Marshal.ThrowExceptionForHR(volume.SetMute(false, ref context));
                if (result.VolumeBefore == 0) Marshal.ThrowExceptionForHR(volume.SetMasterVolumeLevelScalar(0.5f, ref context));
            }
            Marshal.ThrowExceptionForHR(volume.GetMute(out result.MutedAfter));
            Marshal.ThrowExceptionForHR(volume.GetMasterVolumeLevelScalar(out result.VolumeAfter));
            return result;
        }
    }
}
'@
if ($UseSpeakers) {
    $speakers = @(Get-PnpDevice -Class AudioEndpoint | Where-Object {
        $_.Status -eq 'OK' -and $_.FriendlyName -match 'Realtek' -and $_.InstanceId -like '*{0.0.0.00000000}*'
    })
    if ($speakers.Count -ne 1) { throw 'Expected exactly one active Realtek output device.' }
    [LocalAudio.Probe]::SetOutput(($speakers[0].InstanceId -replace '^SWD\\MMDEVAPI\\', ''))
}
$result = [LocalAudio.Probe]::Run($Unmute.IsPresent)
$device = Get-PnpDevice -Class AudioEndpoint | Where-Object { $_.InstanceId -like "*$($result.DeviceId)" }
[pscustomobject]@{
    Device = $device.FriendlyName
    DeviceId = $result.DeviceId
    MutedBefore = $result.MutedBefore
    VolumeBefore = [Math]::Round($result.VolumeBefore * 100)
    MutedAfter = $result.MutedAfter
    VolumeAfter = [Math]::Round($result.VolumeAfter * 100)
} | Format-List
