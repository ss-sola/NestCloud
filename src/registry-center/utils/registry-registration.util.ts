import { ProjectException, ServiceAddressUtil } from '@nest-cloud/sdk';
import { RegisterInstanceForm } from '../form/register-instance.form';
import { RegistryRegistration } from '../registry.types';

export class RegistryRegistrationUtil {
  /** 完整地址独立于实例身份；同时保留 host/port 以供旧消费者读取。 */
  static fromForm(form: RegisterInstanceForm): RegistryRegistration {
    const address = form.baseUrl ? new URL(form.baseUrl) : undefined;
    const host = form.host ?? address?.hostname;
    const port = form.port ?? (address && ServiceAddressUtil.portOf(address));
    if (!host || !port) throw new ProjectException('请提供完整服务地址或主机和端口', 400);
    return { ...form, host, port };
  }
}
