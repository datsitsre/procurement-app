package com.xwiggy.food.model;

import java.util.List;

public class OrderRequest {

    private List<OrderLineRequest> items;

    public OrderRequest() {
    }

    public List<OrderLineRequest> getItems() {
        return items;
    }

    public void setItems(List<OrderLineRequest> items) {
        this.items = items;
    }
}
