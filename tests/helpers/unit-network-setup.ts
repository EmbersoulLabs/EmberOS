import { installCertificationNetworkIsolation } from "./certification-network-isolation";

// Vitest setup runs before test modules import SDKs or construct clients.
installCertificationNetworkIsolation();
