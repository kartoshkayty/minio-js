import * as http from 'node:http';
import { CredentialProvider } from "./CredentialProvider.js";
import { Credentials } from "./Credentials.js";
export interface IamAwsProviderOptions {
  customEndpoint?: string;
  transportAgent?: http.Agent;
}
export declare class IamAwsProvider extends CredentialProvider {
  private readonly customEndpoint?;
  private _credentials;
  private readonly transportAgent?;
  private accessExpiresAt;
  constructor({
    customEndpoint,
    transportAgent
  }: IamAwsProviderOptions);
  getCredentials(): Promise<Credentials>;
  private fetchCredentials;
  private fetchCredentialsUsingTokenFile;
  private fetchImdsToken;
  private getIamRoleNamedUrl;
  private getIamRoleName;
  private requestCredentials;
  private isAboutToExpire;
}
export default IamAwsProvider;