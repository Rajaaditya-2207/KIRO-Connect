"""
KIRO-Connect — LAN Discovery (mDNS / Zeroconf)
Announces host swarm service and allows worker nodes to discover available hosts.
"""

import socket
import logging
import asyncio
from typing import Dict, Any, List, Optional, Callable
from zeroconf import Zeroconf, ServiceInfo, ServiceBrowser, ServiceListener

logger = logging.getLogger("kiro.discovery")
SERVICE_TYPE = "_kiro-connect._tcp.local."


def get_all_local_ips() -> List[str]:
    """Finds all non-loopback, non-link-local IPv4 addresses across network adapters."""
    ips = []
    # 1. Outbound routing test (works when connected to LAN router or internet)
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        primary = s.getsockname()[0]
        s.close()
        if primary and not primary.startswith("127.") and not primary.startswith("169.254."):
            ips.append(primary)
    except Exception:
        pass

    # 2. Hostname resolution over all network adapters
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith("127.") and not ip.startswith("169.254."):
                if ip not in ips:
                    ips.append(ip)
    except Exception:
        pass

    return ips if ips else ["127.0.0.1"]


def get_local_ip() -> str:
    """Finds the primary local LAN IP address of this machine."""
    all_ips = get_all_local_ips()
    if not all_ips:
        return "127.0.0.1"
    # If the first IP is a non-loopback outbound route, use it directly
    primary = all_ips[0]
    if not primary.startswith("127.") and not primary.startswith("169.254."):
        return primary
    for ip in all_ips:
        if ip.startswith("192.168.") or ip.startswith("10.") or ip.startswith("172."):
            return ip
    return all_ips[0]


class SwarmHostBroadcaster:
    """Announces this machine as a KIRO-Connect Swarm Host on the LAN."""

    def __init__(self, host_name: str, gateway_port: int, host_ip: Optional[str] = None):
        self.host_name = host_name
        self.gateway_port = gateway_port
        self.all_ips = get_all_local_ips()
        self.host_ip = host_ip or get_local_ip()
        self.zeroconf: Optional[Zeroconf] = None
        self.service_info: Optional[ServiceInfo] = None
        self.is_broadcasting = False

    def start(self) -> bool:
        if self.is_broadcasting:
            return True

        try:
            self.zeroconf = Zeroconf()
            sanitized_name = self.host_name.replace(" ", "-")
            service_name = f"{sanitized_name}.{SERVICE_TYPE}"

            desc = {
                "name": self.host_name,
                "version": "1.0.0",
                "port": str(self.gateway_port),
                "ip": self.host_ip,
                "all_ips": ",".join(self.all_ips)
            }

            # Register with all detected network adapter IPs so workers on any adapter can connect
            addresses = [socket.inet_aton(ip) for ip in self.all_ips if not ip.startswith("127.")]
            if not addresses:
                addresses = [socket.inet_aton(self.host_ip)]

            self.service_info = ServiceInfo(
                type_=SERVICE_TYPE,
                name=service_name,
                addresses=addresses,
                port=self.gateway_port,
                properties=desc,
                server=f"{sanitized_name}.local."
            )

            self.zeroconf.register_service(self.service_info)
            self.is_broadcasting = True
            logger.info(f"mDNS Swarm Host registered: {service_name} on {', '.join(self.all_ips)}:{self.gateway_port}")
            return True
        except Exception as e:
            logger.error(f"Failed to start mDNS broadcast: {e}")
            return False

    def stop(self):
        if self.is_broadcasting and self.zeroconf and self.service_info:
            try:
                self.zeroconf.unregister_service(self.service_info)
                self.zeroconf.close()
            except Exception as e:
                logger.error(f"Error unregistering mDNS: {e}")
            self.is_broadcasting = False
            self.zeroconf = None
            self.service_info = None
            logger.info("mDNS Swarm Host stopped.")


class SwarmHostListener(ServiceListener):
    def __init__(self, on_update_callback: Optional[Callable[[List[Dict[str, Any]]], None]] = None):
        self.discovered_hosts: Dict[str, Dict[str, Any]] = {}
        self.on_update = on_update_callback

    def remove_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        if name in self.discovered_hosts:
            logger.info(f"mDNS host went offline: {name}")
            del self.discovered_hosts[name]
            if self.on_update:
                self.on_update(list(self.discovered_hosts.values()))

    def add_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        self.update_service(zc, type_, name)

    def update_service(self, zc: Zeroconf, type_: str, name: str) -> None:
        info = zc.get_service_info(type_, name)
        if info:
            addresses = [socket.inet_ntoa(a) for a in info.addresses] if info.addresses else []
            ip = addresses[0] if addresses else "127.0.0.1"
            props = {k.decode("utf-8", "ignore"): v.decode("utf-8", "ignore") if isinstance(v, bytes) else str(v)
                     for k, v in info.properties.items()}
            all_ips = [x.strip() for x in props.get("all_ips", "").split(",") if x.strip()] or addresses or [ip]
            host_data = {
                "service_name": name,
                "display_name": props.get("name", name.split(".")[0]),
                "ip": ip,
                "all_ips": all_ips,
                "port": info.port,
                "version": props.get("version", "1.0.0"),
                "endpoint": f"http://{ip}:{info.port}",
                "endpoints": [f"http://{a}:{info.port}" for a in all_ips]
            }
            self.discovered_hosts[name] = host_data
            logger.info(f"Discovered KIRO-Connect Host: {host_data['display_name']} at {host_data['endpoint']} (all IPs: {', '.join(all_ips)})")
            if self.on_update:
                self.on_update(list(self.discovered_hosts.values()))


class SwarmWorkerBrowser:
    """Browses LAN for available KIRO-Connect Swarm Hosts."""

    def __init__(self, on_update_callback: Optional[Callable[[List[Dict[str, Any]]], None]] = None):
        self.listener = SwarmHostListener(on_update_callback)
        self.zeroconf: Optional[Zeroconf] = None
        self.browser: Optional[ServiceBrowser] = None

    def start(self):
        if self.zeroconf:
            return
        self.zeroconf = Zeroconf()
        self.browser = ServiceBrowser(self.zeroconf, SERVICE_TYPE, self.listener)
        logger.info("Started mDNS browser for KIRO-Connect Hosts.")

    def stop(self):
        if self.browser:
            try:
                self.browser.cancel()
            except Exception:
                pass
            self.browser = None
        if self.zeroconf:
            try:
                self.zeroconf.close()
            except Exception:
                pass
            self.zeroconf = None
            logger.info("Stopped mDNS browser.")

    def get_hosts(self) -> List[Dict[str, Any]]:
        return list(self.listener.discovered_hosts.values())
