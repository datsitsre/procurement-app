package com.xwiggy.food.model;

import jakarta.persistence.Entity;
import jakarta.persistence.Id;
import jakarta.persistence.Version;

@Entity
public class Food {

    @Id
    private String id;
    private String item;
    private int price;
    private int quantity;
    private String url;
    private String formID;
    private String cartID;
    private String category;

    // Optimistic lock: without this, two concurrent payOrder() calls for the last unit of an
    // item can both read the same quantity, both pass the stock check, and both write - one
    // update is lost and the item is oversold with no error to either caller. With @Version,
    // the second writer's save() throws (Hibernate bumps/compares this on every UPDATE), so
    // OrderService can retry the stock check instead of silently losing an update.
    @Version
    private Long version;

    public Food(){}

    public Food(String id, String item, int price,int quantity, String url, String formID, String cartID, String category) {
        this.id = id;
        this.item = item;
        this.price = price;
        this.quantity=quantity;
        this.url=url;
        this.formID=formID;
        this.cartID=cartID;
        this.category=category;
    }

    public String getCategory() {
        return category;
    }

    public void setCategory(String category) {
        this.category = category;
    }

    public String getFormID() {
        return formID;
    }

    public void setFormID(String formID) {
        this.formID = formID;
    }

    public String getCartID() {
        return cartID;
    }

    public void setCartID(String cartID) {
        this.cartID = cartID;
    }

    public String getUrl(){
        return url;
    }

    public void setUrl(String url){
        this.url=url;
    }

    public String getId() {
        return id;
    }

    public void setId(String id) {
        this.id = id;
    }

    public String getItem() {
        return item;
    }

    public void setItem(String item) {
        this.item = item;
    }

    public int getPrice() {
        return price;
    }

    public void setPrice(int price) {
        this.price = price;
    }

    public int getQuantity() {
        return quantity;
    }

    public void setQuantity(int quantity) {
        this.quantity = quantity;
    }

    @Override
    public String toString() {
        return "Food{" +
                "id='" + id + '\'' +
                ", item='" + item + '\'' +
                ", price=" + price +
                ", quantity=" + quantity +
                ", url='" + url + '\'' +
                ", formID='" + formID + '\'' +
                ", cartID='" + cartID + '\'' +
                ", category='" + category + '\'' +
                '}';
    }
}
