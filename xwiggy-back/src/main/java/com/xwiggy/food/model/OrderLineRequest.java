package com.xwiggy.food.model;

public class OrderLineRequest {

    private String foodId;
    private int quantity;

    public OrderLineRequest() {
    }

    public String getFoodId() {
        return foodId;
    }

    public void setFoodId(String foodId) {
        this.foodId = foodId;
    }

    public int getQuantity() {
        return quantity;
    }

    public void setQuantity(int quantity) {
        this.quantity = quantity;
    }
}
