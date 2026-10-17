export interface ReadRepository<T> {
  getAll(): Promise<T[]>;
  getById(id: string): Promise<T | null>;
}

export interface CrudRepository<
  T,
  CreateInput = Omit<T, "id" | "createdAt" | "updatedAt">,
  UpdateInput = Partial<CreateInput>,
> extends ReadRepository<T> {
  create(input: CreateInput): Promise<T>;
  update(id: string, input: UpdateInput): Promise<T>;
}
