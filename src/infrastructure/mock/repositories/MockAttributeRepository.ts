import type { AttributeRepository } from "@/core/repositories";
import { BaseMockRepository } from "@/infrastructure/mock/repositories/base";
export class MockAttributeRepository extends BaseMockRepository implements AttributeRepository {
  async getDefinitions() {
    return this.read((db) => db.attributeDefinitions);
  }
  async getValuesByProduct(productId: string) {
    return this.read((db) =>
      db.productAttributeValues.filter((item) => item.productId === productId),
    );
  }
  async createDefinition(input: Parameters<AttributeRepository["createDefinition"]>[0]) {
    const item = this.store.mutate((db) => {
      const now = this.now();
      const created = { ...input, id: this.id("attribute"), createdAt: now, updatedAt: now };
      db.attributeDefinitions.push(created);
      return created;
    });
    this.emit("product.changed", { tenantId: item.tenantId, action: "updated" });
    return item;
  }
  async updateDefinition(
    id: string,
    input: Parameters<AttributeRepository["updateDefinition"]>[1],
  ) {
    return this.store.mutate((db) =>
      this.updateById(db.attributeDefinitions, id, input, "AttributeDefinition"),
    );
  }
  async setProductValue(input: Parameters<AttributeRepository["setProductValue"]>[0]) {
    const item = this.store.mutate((db) => {
      const existing = db.productAttributeValues.find(
        (item) =>
          item.productId === input.productId &&
          item.attributeDefinitionId === input.attributeDefinitionId,
      );
      if (existing) {
        existing.value = input.value;
        return existing;
      }
      const created = { ...input, id: this.id("attribute-value") };
      db.productAttributeValues.push(created);
      return created;
    });
    this.emit("product.changed", { productId: item.productId, action: "updated" });
    return item;
  }
  async replaceValuesForProduct(
    productId: string,
    values: Parameters<AttributeRepository["replaceValuesForProduct"]>[1],
  ) {
    const items = this.store.mutate((db) => {
      db.productAttributeValues = db.productAttributeValues.filter(
        (item) => item.productId !== productId,
      );
      const created = values.map((value) => ({
        ...value,
        productId,
        id: this.id("attribute-value"),
      }));
      db.productAttributeValues.push(...created);
      return created;
    });
    this.emit("product.changed", { productId, action: "updated" });
    return items;
  }
}
