export interface NewDocument { employeeId: string; }
export interface Document extends NewDocument { id: string; fileKey: string; }
