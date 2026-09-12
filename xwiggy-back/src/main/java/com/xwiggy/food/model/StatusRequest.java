package com.xwiggy.food.model;

/** Body of a merchant order-status update request, e.g. {"status": "CONFIRMED"}. */
public class StatusRequest {

    private String status;

    public StatusRequest() {
    }

    public String getStatus() {
        return status;
    }

    public void setStatus(String status) {
        this.status = status;
    }
}
